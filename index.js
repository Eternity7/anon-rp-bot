require('dotenv').config();
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, EmbedBuilder, ThreadAutoArchiveDuration
} = require('discord.js');
const db = require('./database');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages]
});

async function registerCommands() {
  const command = new SlashCommandBuilder()
    .setName('rp-1x1')
    .setDescription('Gửi bài RP ẩn danh để mod duyệt');

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: [command.toJSON()] }
  );
  console.log('Slash command registered.');
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {

  // 1. Slash command → open modal
  if (interaction.isChatInputCommand() && interaction.commandName === 'rp-1x1') {
    const modal = new ModalBuilder()
      .setCustomId('rp_submit_modal')
      .setTitle('Gửi bài RP ẩn danh');

    const pseudonymInput = new TextInputBuilder()
      .setCustomId('pseudonym')
      .setLabel('Tên bút danh (để trống = "Ẩn danh")')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(32)
      .setPlaceholder('VD: "Một người lữ hành"');

    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Tiêu đề bài viết')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const contentInput = new TextInputBuilder()
      .setCustomId('content')
      .setLabel('Nội dung bài RP')
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

  // 2. Modal submitted → save to DB + send to mod review
  if (interaction.isModalSubmit() && interaction.customId === 'rp_submit_modal') {
    await interaction.deferReply({ ephemeral: true });

    const pseudonym = interaction.fields.getTextInputValue('pseudonym').trim() || 'Ẩn danh';
    const title     = interaction.fields.getTextInputValue('title').trim();
    const content   = interaction.fields.getTextInputValue('content').trim();
    const submissionId = `${interaction.user.id}_${Date.now()}`;

    db.saveSubmission(submissionId, interaction.user.id, pseudonym, title, content);

    const reviewChannel = await client.channels.fetch(process.env.MOD_REVIEW_CHANNEL_ID);

    const reviewEmbed = new EmbedBuilder()
      .setTitle('📋 Bài RP mới cần duyệt')
      .addFields(
        { name: 'Bút danh', value: pseudonym, inline: true },
        { name: 'Tiêu đề', value: title, inline: true },
        { name: 'Nội dung', value: content }
      )
      .setColor(0x5865F2)
      .setFooter({ text: `Submission ID: ${submissionId}` })
      .setTimestamp();

    const approveBtn = new ButtonBuilder()
      .setCustomId(`approve_${submissionId}`)
      .setLabel('Duyệt')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const denyBtn = new ButtonBuilder()
      .setCustomId(`deny_${submissionId}`)
      .setLabel('Từ chối (kèm lý do)')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌');

    const row = new ActionRowBuilder().addComponents(approveBtn, denyBtn);

    await reviewChannel.send({ embeds: [reviewEmbed], components: [row] });
    await interaction.editReply({ content: '✅ Bài của bạn đã được gửi để mod duyệt! Bạn sẽ được thông báo kết quả.' });
  }

  // 3. Approve button
  if (interaction.isButton() && interaction.customId.startsWith('approve_')) {
    const submissionId = interaction.customId.replace('approve_', '');
    const submission   = db.getSubmission(submissionId);

    if (!submission) {
      return interaction.reply({ content: '⚠️ Không tìm thấy bài viết.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const rpChannel = await client.channels.fetch(process.env.RP_CHANNEL_ID);

    const rpEmbed = new EmbedBuilder()
      .setAuthor({ name: submission.pseudonym })
      .setTitle(submission.title)
      .setDescription(submission.content)
      .setColor(0x57F287)
      .setTimestamp();

    // Reply in DMs button under the RP post
    const dmBtn = new ButtonBuilder()
      .setCustomId(`dm_reply_${submissionId}`)
      .setLabel('Reply in DMs')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✉️');

    const dmRow = new ActionRowBuilder().addComponents(dmBtn);

    const rpMessage = await rpChannel.send({ embeds: [rpEmbed], components: [dmRow] });

    // Create thread
    const thread = await rpMessage.startThread({
      name: submission.title,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: 'Anonymous RP thread'
    });

    await thread.send(`*Ứng tuyển bằng cách comment ở dưới:*`);

    // Update review message — disable buttons
    const disabledRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
      ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
    );
    await interaction.message.edit({
      components: [disabledRow],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x57F287)
        .setFooter({ text: `✅ Đã duyệt bởi ${interaction.user.tag}` })]
    });

    // DM the submitter
    try {
      const submitter = await client.users.fetch(submission.user_id);
      await submitter.send(`✅ Bài của bạn đã được duyệt và được post!`);
    } catch {}

    db.deleteSubmission(submissionId);
    await interaction.editReply({ content: '✅ Bài đã được duyệt và đăng!' });
  }

  // 4. Deny button → open reason modal
  if (interaction.isButton() && interaction.customId.startsWith('deny_') && !interaction.customId.startsWith('deny_reason_')) {
    const submissionId = interaction.customId.replace('deny_', '');

    const modal = new ModalBuilder()
      .setCustomId(`deny_reason_${submissionId}`)
      .setTitle('Từ chối bài viết');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Lý do từ chối')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  // 5. Deny reason submitted
  if (interaction.isModalSubmit() && interaction.customId.startsWith('deny_reason_')) {
    const submissionId = interaction.customId.replace('deny_reason_', '');
    const submission   = db.getSubmission(submissionId);
    const reason       = interaction.fields.getTextInputValue('reason').trim();

    await interaction.deferReply({ ephemeral: true });

    if (!submission) {
      return interaction.editReply({ content: '⚠️ Không tìm thấy bài viết.' });
    }

    const disabledRow = new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
      ButtonBuilder.from(interaction.message.components[0].components[1]).setDisabled(true)
    );
    await interaction.message.edit({
      components: [disabledRow],
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xED4245)
        .setFooter({ text: `❌ Từ chối bởi ${interaction.user.tag}` })]
    });

    try {
      const submitter = await client.users.fetch(submission.user_id);
      await submitter.send(`❌ Bài RP **"${submission.title}"** của bạn đã bị từ chối.\n\n**Lý do:** ${reason}`);
    } catch {}

    db.deleteSubmission(submissionId);
    await interaction.editReply({ content: '❌ Đã từ chối và thông báo cho người gửi.' });
  }

  // 6. Reply in DMs button
  if (interaction.isButton() && interaction.customId.startsWith('dm_reply_')) {
    const submissionId = interaction.customId.replace('dm_reply_', '');

    // Check if submission still exists in DB (may be deleted after approval)
    // Store submitter user_id separately for DM replies
    const storedUserId = db.getSubmitterUserId(submissionId);

    if (!storedUserId) {
      return interaction.reply({ content: '⚠️ Không thể tìm thấy người đăng bài.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId(`send_dm_${submissionId}`)
      .setTitle('Gửi tin nhắn ẩn danh');

    const messageInput = new TextInputBuilder()
      .setCustomId('dm_message')
      .setLabel('Tin nhắn của bạn')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
    await interaction.showModal(modal);
  }

  // 7. Send DM modal submitted
  if (interaction.isModalSubmit() && interaction.customId.startsWith('send_dm_')) {
    const submissionId = interaction.customId.replace('send_dm_', '');
    const message      = interaction.fields.getTextInputValue('dm_message').trim();

    await interaction.deferReply({ ephemeral: true });

    const storedUserId = db.getSubmitterUserId(submissionId);

    if (!storedUserId) {
      return interaction.editReply({ content: '⚠️ Không thể tìm thấy người đăng bài.' });
    }

    try {
      const submitter = await client.users.fetch(storedUserId);
      await submitter.send(`📩 **Tin nhắn ẩn danh từ bài RP của bạn:**\n\n${message}`);
      await interaction.editReply({ content: '✅ Tin nhắn đã được gửi!' });
    } catch {
      await interaction.editReply({ content: '❌ Không thể gửi DM. Người dùng có thể đã tắt DM.' });
    }
  }
});

client.login(process.env.BOT_TOKEN);
