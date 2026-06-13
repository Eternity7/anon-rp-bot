require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
  try {
    console.log('Fetching global commands...');
    const globalCommands = await rest.get(Routes.applicationCommands(process.env.CLIENT_ID));
    console.log('Global commands found:', globalCommands.map(c => c.name));

    for (const cmd of globalCommands) {
      if (cmd.name === 'rp-1x1') {
        console.log(`Deleting global command: ${cmd.name} (${cmd.id})`);
        await rest.delete(Routes.applicationCommand(process.env.CLIENT_ID, cmd.id));
      }
    }

    // If GUILD_ID is set, also check guild-specific commands
    if (process.env.GUILD_ID) {
      console.log('Fetching guild commands...');
      const guildCommands = await rest.get(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID));
      console.log('Guild commands found:', guildCommands.map(c => c.name));

      for (const cmd of guildCommands) {
        if (cmd.name === 'rp-1x1') {
          console.log(`Deleting guild command: ${cmd.name} (${cmd.id})`);
          await rest.delete(Routes.applicationGuildCommand(process.env.CLIENT_ID, process.env.GUILD_ID, cmd.id));
        }
      }
    }

    console.log('Done! /rp-1x1 has been removed.');
  } catch (err) {
    console.error(err);
  }
})();
