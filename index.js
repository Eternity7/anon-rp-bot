require('dotenv').config();
const http = require('http');
http.createServer((req, res) => res.end('Bot is running!')).listen(8080);
const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, EmbedBuilder, ThreadAutoArchiveDuration
} = require('discord.js');
const db = require('./database');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages]
});

// ── Register slash commands ─────────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('rp-anon')
      .setDescription('Submit an anonymous RP post for mod approval'),

    new SlashCommandBuilder()
      .setName('rp-setup')
      .setDescription('Configure channels for the RP system (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(opt => opt
        .setName('review_channel')
        .setDescription('Channel where mods review submissions')
        .setRequired(true))
      .addChannelOption(opt => opt
        .setName('rp_channel')
        .setDescription('Channel where approved RP posts are published')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('rp-toggle')
      .setDescription('Toggle mod review on or off (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(opt => opt
        .setName('mode')
        .setDescription('Enable or disable mod review')
        .setRequired(true)
        .addChoices(
          { name: '🟢 Enable mod review', value: 'on' },
          { name: '🔴 Disable mod review (auto-approve)', value: 'off' }
        )),

    new SlashCommandBuilder()
      .setName('rp-unban')
      .setDescription('Unban a user from the RP system (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption(opt => opt
        .setName('user')
        .setDescription('User to unban')
        .setRequired(true)),

    new SlashCommandBuilder()
      .setName('rp-banlist')
      .setDescription('View all banned users in the RP system (Admin only)')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log('Global slash commands registered.');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

// ── Helper: build the RP submission modal ───────────────────────────────────
function buildSubmitModal() {
  const modal = new ModalBuilder()
    .setCustomId('rp_submit_modal')
    .setTitle('Submit Anonymous RP Post');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('pseudonym')
        .setLabel('Pseudonym (leave blank for "Anonymous")')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(32)
        .setPlaceholder('e.g. "A Wandering Stranger"')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Post Title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Your RP Post')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
    )
  );

  return modal;
}

// ── Helper: post to RP channel ──────────────────────────────────────────────
async function postToRpChannel(client, submission, settings) {
  const rpChannel = await client.channels.fetch(settings.rp_channel_id);

  const rpEmbed = new EmbedBuilder()
    .setAuthor({ name: submission.pseudonym })
    .setTitle(submission.title)
    .setDescription(submission.content)
    .setColor(0x57F287)
    .setTimestamp();

  const dmBtn = new ButtonBuilder()
    .setCustomId(`dm_reply_${submission.id}`)
    .setLabel('Reply in DMs')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('✉️');

  const submitBtn = new ButtonBuilder()
    .setCustomId('submit_anon_rp')
    .setLabel('Submit Anonymous Roleplay')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📝');

  const rpMessage = await rpChannel.send({
    embeds: [rpEmbed],
    components: [new ActionRowBuilder().addComponents(dmBtn, submitBtn)]
  });

  const thread = await rpMessage.startThread({
    name: submission.title,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: 'Anonymous RP thread'
  });

  await thread.send(`*A new RP post has opened: **${submission.title}** — posted by **${submission.pseudonym}**. Reply below to join!*`);
  return rpMessage;
}

// ── Interaction handler ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  const guildId = interaction.guildId;

  // ── /rp-setup ─────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-setup') {
    const reviewChannel = interaction.options.getChannel('review_channel');
    const rpChannel     = interaction.options.getChannel('rp_channel');

    db.setGuildSettings(guildId, reviewChannel.id, rpChannel.id);

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('✅ RP System configured!')
        .addFields(
          { name: 'Review Channel', value: `<#${reviewChannel.id}>`, inline: true },
          { name: 'RP Channel', value: `<#${rpChannel.id}>`, inline: true }
        )
        .setColor(0x57F287)],
      ephemeral: true
    });
  }

  // ── /rp-toggle ────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-toggle') {
    const mode    = interaction.options.getString('mode');
    const enabled = mode === 'on';

    db.toggleModReview(guildId, enabled);

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle(enabled ? '🟢 Mod review enabled' : '🔴 Mod review disabled')
        .setDescription(enabled
          ? 'Submissions will be sent to mods for review before being posted.'
          : 'Submissions will be posted automatically without mod review.')
        .setColor(enabled ? 0x57F287 : 0xED4245)],
      ephemeral: true
    });
  }

  // ── /rp-unban ─────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-unban') {
    const user = interaction.options.getUser('user');
    db.unbanUser(guildId, user.id);

    await interaction.reply({
      content: `✅ **${user.tag}** has been unbanned from the RP system.`,
      ephemeral: true
    });
  }

  // ── /rp-banlist ───────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-banlist') {
    const banned = db.getBannedUsers(guildId);

    if (banned.length === 0) {
      return interaction.reply({ content: '✅ No users are currently banned.', ephemeral: true });
    }

    const list = banned.map((b, i) =>
      `${i + 1}. <@${b.user_id}> — **Reason:** ${b.reason || 'No reason provided'} — **Banned by:** ${b.banned_by}`
    ).join('\n');

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🚫 Banned Users')
        .setDescription(list)
        .setColor(0xED4245)],
      ephemeral: true
    });
  }

  // ── /rp-anon ──────────────────────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-anon') {
    const settings = db.getGuildSettings(guildId);

    if (!settings || !settings.rp_channel_id) {
      return interaction.reply({
        content: '⚠️ This bot has not been configured yet! Ask an admin to run `/rp-setup` first.',
        ephemeral: true
      });
    }

    if (db.isUserBanned(guildId, interaction.user.id)) {
      return interaction.reply({
        content: '🚫 You have been banned from the RP system on this server.',
        ephemeral: true
      });
    }

    const modal = buildSubmitModal();
    await interaction.showModal(modal);
  }

  // ── Button: submit_anon_rp (Submit Anonymous Roleplay button on posts) ──
  if (interaction.isButton() && interaction.customId === 'submit_anon_rp') {
    const settings = db.getGuildSettings(guildId);

    if (!settings || !settings.rp_channel_id) {
      return interaction.reply({
        content: '⚠️ This bot has not been configured yet! Ask an admin to run `/rp-setup` first.',
        ephemeral: true
      });
    }

    if (db.isUserBanned(guildId, interaction.user.id)) {
      return interaction.reply({
        content: '🚫 You have been banned from the RP system on this server.',
        ephemeral: true
      });
    }

    const modal = buildSubmitModal();
    await interaction.showModal(modal);
  }

  // ── Modal: rp_submit_modal ────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'rp_submit_modal') {
    await interaction.deferReply({ ephemeral: true });

    const settings     = db.getGuildSettings(guildId);
    const pseudonym    = interaction.fields.getTextInputValue('pseudonym').trim() || 'Anonymous';
    const title        = interaction.fields.getTextInputValue('title').trim();
    const content      = interaction.fields.getTextInputValue('content').trim();
    const submissionId = `${guildId}_${interaction.user.id}_${Date.now()}`;

    db.saveSubmission(submissionId, guildId, interaction.user.id, pseudonym, title, content);

    // Auto approve if mod review is off
    if (!settings.mod_review_enabled) {
      await postToRpChannel(client, { id: submissionId, pseudonym, title, content, user_id: interaction.user.id }, settings);
      db.deleteSubmission(submissionId);
      return interaction.editReply({ content: '✅ Your post has been automatically published!' });
    }

    // Send to mod review
    const reviewChannel = await client.channels.fetch(settings.review_channel_id);

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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${submissionId}`).setLabel('Approve').setStyle(ButtonStyle.Success).setEmoji('✅'),
      new ButtonBuilder().setCustomId(`deny_${submissionId}`).setLabel('Deny with Reason').setStyle(ButtonStyle.Danger).setEmoji('❌'),
      new ButtonBuilder().setCustomId(`ban_${submissionId}`).setLabel('Ban User').setStyle(ButtonStyle.Danger).setEmoji('🚫')
    );

    await reviewChannel.send({ embeds: [reviewEmbed], components: [row] });
    await interaction.editReply({ content: '✅ Your RP post has been submitted for review! You will be notified of the decision.' });
  }

  // ── Button: approve ───────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    const submissionId = interaction.customId.replace('approve_', '');
    const submission   = db.getSubmission(submissionId);
    const settings     = db.getGuildSettings(guildId);

    if (!submission) return interaction.reply({ content: '⚠️ Submission not found.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    await postToRpChannel(client, submission, settings);

    await interaction.message.edit({
      components: [new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[2]).setDisabled(true)
      )],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x57F287)
        .setFooter({ text: `✅ Approved by ${interaction.user.tag}` })]
    });

    try {
      const submitter = await client.users.fetch(submission.user_id);
      await submitter.send(`✅ Your RP post **"${submission.title}"** has been approved and published!`);
    } catch {}

    db.deleteSubmission(submissionId);
    await interaction.editReply({ content: '✅ Post approved and published!' });
  }

  // ── Button: deny ──────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('deny_')) {
    const submissionId = interaction.customId.replace('deny_', '');

    const modal = new ModalBuilder()
      .setCustomId(`deny_reason_${submissionId}`)
      .setTitle('Deny Submission');

    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for denial')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    ));

    await interaction.showModal(modal);
  }

  // ── Button: ban ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('ban_')) {
    const submissionId = interaction.customId.replace('ban_', '');

    const modal = new ModalBuilder()
      .setCustomId(`ban_reason_${submissionId}`)
      .setTitle('Ban User');

    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for ban')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    ));

    await interaction.showModal(modal);
  }

  // ── Modal: deny_reason ────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('deny_reason_')) {
    const submissionId = interaction.customId.replace('deny_reason_', '');
    const submission   = db.getSubmission(submissionId);
    const reason       = interaction.fields.getTextInputValue('reason').trim();

    await interaction.deferReply({ ephemeral: true });
    if (!submission) return interaction.editReply({ content: '⚠️ Submission not found.' });

    await interaction.message.edit({
      components: [new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[2]).setDisabled(true)
      )],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xED4245)
        .setFooter({ text: `❌ Denied by ${interaction.user.tag}` })]
    });

    try {
      const submitter = await client.users.fetch(submission.user_id);
      await submitter.send(`❌ Your RP post **"${submission.title}"** was not approved.\n\n**Reason:** ${reason}`);
    } catch {}

    db.deleteSubmission(submissionId);
    await interaction.editReply({ content: '❌ Submission denied and submitter notified.' });
  }

  // ── Modal: ban_reason ─────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ban_reason_')) {
    const submissionId = interaction.customId.replace('ban_reason_', '');
    const submission   = db.getSubmission(submissionId);
    const reason       = interaction.fields.getTextInputValue('reason').trim();

    await interaction.deferReply({ ephemeral: true });
    if (!submission) return interaction.editReply({ content: '⚠️ Submission not found.' });

    db.banUser(guildId, submission.user_id, reason, interaction.user.tag);

    await interaction.message.edit({
      components: [new ActionRowBuilder().addComponents(
        ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true),
        ButtonBuilder.from(interaction.message.components[0].components[2]).setDisabled(true)
      )],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xFF0000)
        .setFooter({ text: `🚫 Banned by ${interaction.user.tag} — ${reason}` })]
    });

    try {
      const submitter = await client.users.fetch(submission.user_id);
      await submitter.send(`🚫 You have been banned from the RP system on this server.\n\n**Reason:** ${reason}\n\nIf you believe this is a mistake, please contact a server admin.`);
    } catch {}

    db.deleteSubmission(submissionId);
    await interaction.editReply({ content: `🚫 User has been banned from the RP system. Use \`/rp-unban\` to reverse this.` });
  }

  // ── Button: dm_reply ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith('dm_reply_')) {
    const submissionId = interaction.customId.replace('dm_reply_', '');
    const storedUserId = db.getSubmitterUserId(submissionId);

    if (!storedUserId) return interaction.reply({ content: '⚠️ Could not find the original poster.', ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId(`send_dm_${submissionId}`)
      .setTitle('Send Anonymous Message');

    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dm_message')
        .setLabel('Your message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
    ));

    await interaction.showModal(modal);
  }

  // ── Modal: send_dm ────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('send_dm_')) {
    const submissionId = interaction.customId.replace('send_dm_', '');
    const message      = interaction.fields.getTextInputValue('dm_message').trim();
    const storedUserId = db.getSubmitterUserId(submissionId);

    await interaction.deferReply({ ephemeral: true });
    if (!storedUserId) return interaction.editReply({ content: '⚠️ Could not find the original poster.' });

    try {
      const submitter = await client.users.fetch(storedUserId);
      await submitter.send(`📩 **Anonymous message regarding your RP post:**\n\n${message}`);
      await interaction.editReply({ content: '✅ Your message has been sent!' });
    } catch {
      await interaction.editReply({ content: '❌ Could not send DM. The user may have DMs disabled.' });
    }
  }
});

client.login(process.env.BOT_TOKEN);
