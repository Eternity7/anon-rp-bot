require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, EmbedBuilder, ThreadAutoArchiveDuration
} = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Map to store pending submissions: submissionId -> { userId, pseudonym, title, content }
const pendingSubmissions = new Map();

// ── Register slash command ──────────────────────────────────────────────────
async function registerCommands() {
  const command = new SlashCommandBuilder()
    .setName('rp-submit')
    .setDescription('Submit an anonymous RP post for mod approval');

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [command.toJSON()] }
  );
  console.log('Slash command registered.');
}

// ── Bot ready ───────────────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ── Interaction handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // 1. Slash command → open modal
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-submit') {
    const modal = new ModalBuilder()
      .setCustomId('rp_submit_modal')
      .setTitle('Submit Anonymous RP Post');

    const pseudonymInput = new TextInputBuilder()
      .setCustomId('pseudonym')
      .setLabel('Pseudonym (leave blank for "Anonymous")')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(32)
      .setPlaceholder('e.g. "A Wandering Stranger"');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Post Title')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const contentInput = new TextInputBuilder()
      .setCustomId('content')
      .setLabel('Your RP Post')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);

    modal.addComponents(
      new ActionRowBuilder().addComponents(pseudonymInput),
      new ActionRowBuilder().addComponents(titleInput),
      new ActionRowBuilder().addComponents(contentInput)
    );

    await interaction.showModal(modal);
  }

  // 2. Modal submitted → send to mod review channel
  if (interaction.isModalSubmit() && interaction.customId === 'rp_submit_modal') {
    await interaction.deferReply({ ephemeral: true });

    const pseudonym = interaction.fields.getTextInputValue('pseudonym').trim() || 'Anonymous';
    const title     = interaction.fields.getTextInputValue('title').trim();
    const content   = interaction.fields.getTextInputValue('content').trim();
    const submissionId = `${interaction.user.id}_${Date.now()}`;

    pendingSubmissions.set(submissionId, {
      userId: interaction.user.id,
      pseudonym,
      title,
      content
    });

    const reviewChannel = await client.channels.fetch(process.env.MOD_REVIEW_CHANNEL_ID);

    const reviewEmbed = new EmbedBuilder()
      .setTitle('📋 New Anonymous RP Submission')
      .addFields(
        { name: 'Pseudonym', value: pseudonym, inline: true },
        { name: 'Post Title', value: title, inline: true },
        { name: 'Content', value: content }
      )
      .setColor(0x5865F2)
      .setFooter({ text: `Submission ID: ${submissionId}` })
      .setTimestamp();

    const approveBtn = new ButtonBuilder()
      .setCustomId(`approve_${submissionId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const denyBtn = new ButtonBuilder()
      .setCustomId(`deny_${submissionId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(approveBtn, denyBtn);

    await reviewChannel.send({ embeds: [reviewEmbed], components: [row] });
    await interaction.editReply({ content: '✅ Your RP post has been submitted for review! You will be notified when a decision is made.' });
  }

  // 3. Approve button
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    const submissionId = interaction.customId.replace('approve_', '');
    const submission   = pendingSubmissions.get(submissionId);

    if (!submission) {
      return interaction.reply({ content: '⚠️ Submission not found (bot may have restarted).', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Post to RP channel
    const rpChannel = await client.channels.fetch(process.env.RP_CHANNEL_ID);

    const rpEmbed = new EmbedBuilder()
      .setAuthor({ name: submission.pseudonym })
      .setTitle(submission.title)
      .setDescription(submission.content)
      .setColor(0x57F287)
      .setTimestamp();

    const rpMessage = await rpChannel.send({ embeds: [rpEmbed] });

    // Create thread on the post
    const thread = await rpMessage.startThread({
      name: submission.title,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: 'Anonymous RP thread'
    });

    await thread.send(`*A new RP thread has opened: **${submission.title}** — posted by **${submission.pseudonym}**. Jump in and roleplay below!*`);

    // Update review message — disable buttons
    const disabledRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
      ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
    );
    await interaction.message.edit({
      components: [disabledRow],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x57F287).setFooter({ text: `✅ Approved by ${interaction.user.tag}` })]
    });

    // DM the submitter
    try {
      const submitter = await client.users.fetch(submission.userId);
      await submitter.send(`✅ Your RP post **"${submission.title}"** has been approved and posted!`);
    } catch {}

    pendingSubmissions.delete(submissionId);
    await interaction.editReply({ content: '✅ Post approved and published!' });
  }

  // 4. Deny button → open modal for reason
  if (interaction.isButton() && interaction.customId.startsWith('deny_')) {
    const submissionId = interaction.customId.replace('deny_', '');

    const modal = new ModalBuilder()
      .setCustomId(`deny_reason_${submissionId}`)
      .setTitle('Deny Submission');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Reason for denial')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  // 5. Deny reason submitted
  if (interaction.isModalSubmit() && interaction.customId.startsWith('deny_reason_')) {
    const submissionId = interaction.customId.replace('deny_reason_', '');
    const submission   = pendingSubmissions.get(submissionId);
    const reason       = interaction.fields.getTextInputValue('reason').trim();

    await interaction.deferReply({ ephemeral: true });

    if (!submission) {
      return interaction.editReply({ content: '⚠️ Submission not found.' });
    }

    // Update review message — disable buttons
    const disabledRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
      ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
    );
    await interaction.message.edit({
      components: [disabledRow],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xED4245).setFooter({ text: `❌ Denied by ${interaction.user.tag}` })]
    });

    // DM the submitter with reason
    try {
      const submitter = await client.users.fetch(submission.userId);
      await submitter.send(`❌ Your RP post **"${submission.title}"** was not approved.\n\n**Reason:** ${reason}`);
    } catch {}

    pendingSubmissions.delete(submissionId);
    await interaction.editReply({ content: '❌ Submission denied and submitter notified.' });
  }
});

client.login(process.env.BOT_TOKEN);
