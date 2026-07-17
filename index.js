import { Client, GatewayIntentBits, ActionRowBuilder, StringSelectMenuBuilder, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, PermissionsBitField } from 'discord.js';
import schedule from 'node-schedule';

const TOKEN = process.env.TOKEN;

// 📌 IDs
const LOG_CHANNEL = "1527120241212133386";
const ALLOWED_ROLES = ["1477108715290362096"];
const ACTIVE_CHANNEL = "1527120241212133386";

// ⚡ الإنذارات والرتب
const ROLES = {
  verbal: { id: "1527556605065953352", name: "انذار شفهي", duration: 3 * 24 * 60 * 60 * 1000 },
  warn1: { id: "1527121297828610089", name: "انذار أول", duration: 14 * 24 * 60 * 60 * 1000 },
  warn2: { id: "1527121500753104977", name: "انذار ثاني", duration: 30 * 24 * 60 * 60 * 1000 },
  warn3: { id: "1527121550199886106", name: "انذار ثالث", duration: 45 * 24 * 60 * 60 * 1000 },
  block: { id: "1364025035022401536", name: "مستبعد من التقسيمة", duration: null },
  black: { id: "1524147615866945666", name: "بلاك ليست", duration: null },
  test: { id: null, name: "تجربة", duration: 1 * 60 * 1000 } // دقيقة
};

const temp = new Map();
const activeWarnings = new Map(); // لتخزين الإنذارات الحالية

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", async () => {
  console.log("Bot Ready");

  const cmd = new SlashCommandBuilder()
    .setName("عقوبات")
    .setDescription("لوحة الانذارات")
    .addUserOption(o => o.setName("الشخص").setDescription("اختر الشخص").setRequired(true));

  const checkCmd = new SlashCommandBuilder()
    .setName("فحص")
    .setDescription("عرض الأشخاص الذين عليهم إنذارات");

  await client.application.commands.set([cmd, checkCmd]);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.channelId !== ACTIVE_CHANNEL) return;

  // أمر فحص
  if (interaction.isChatInputCommand() && interaction.commandName === "فحص") {
    const now = Date.now();
    const embed = new EmbedBuilder()
      .setTitle("📋 الأشخاص الذين عليهم إنذارات")
      .setColor(0xFFAA00);

    if (activeWarnings.size === 0) {
      embed.setDescription("لا يوجد أشخاص لديهم إنذارات حالياً.");
    } else {
      activeWarnings.forEach((info, userId) => {
        const remaining = info.endTime ? info.endTime - now : null;
        let timeLeft;
        if (!remaining) timeLeft = "دائم";
        else if (remaining < 60 * 1000) timeLeft = "أقل من دقيقة";
        else if (remaining < 60 * 60 * 1000) timeLeft = Math.ceil(remaining / 60000) + " دقيقة";
        else if (remaining < 24 * 60 * 60 * 1000) timeLeft = Math.ceil(remaining / 3600000) + " ساعة";
        else timeLeft = Math.ceil(remaining / 86400000) + " يوم";

        embed.addFields({ name: `<@${userId}>`, value: `الإنذار: ${info.typeName}\nالمدة المتبقية: ${timeLeft}` });
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // أمر إعطاء إنذار
  if (interaction.isChatInputCommand() && interaction.commandName === "عقوبات") {
    const hasRole = interaction.member.roles.cache.some(r => ALLOWED_ROLES.includes(r.id));
    if (!hasRole) return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    const user = interaction.options.getUser("الشخص");
    temp.set(interaction.user.id, { target: user.id });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("types")
      .setPlaceholder("اختر العقوبة")
      .addOptions(Object.entries(ROLES).map(([key, val]) => ({ label: val.name, value: key })));

    return interaction.reply({ content: "اختر العقوبة:", components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "types") {
    const data = temp.get(interaction.user.id);
    data.type = interaction.values[0];

    if (["verbal","warn1","warn2","warn3","test"].includes(data.type)) {
      data.duration = ROLES[data.type].duration;
      showReasonModal(interaction);
    } else {
      const menu = new StringSelectMenuBuilder()
        .setCustomId("duration")
        .setPlaceholder("اختر المدة")
        .addOptions([
          { label: "تجربة", value: "test" },
          { label: "يوم", value: "day" },
          { label: "اسبوع", value: "week" },
          { label: "دائم", value: "permanent" }
        ]);
      return interaction.update({ content: "اختر المدة:", components: [new ActionRowBuilder().addComponents(menu)] });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === "duration") {
    const data = temp.get(interaction.user.id);
    const val = interaction.values[0];
    if (val === "test") data.duration = ROLES.test.duration;
    else if (val === "day") data.duration = 24*60*60*1000;
    else if (val === "week") data.duration = 7*24*60*60*1000;
    else data.duration = null;
    showReasonModal(interaction);
  }

  if (interaction.isModalSubmit() && interaction.customId === "reasonModal") {
    await interaction.deferReply({ ephemeral: true });

    const data = temp.get(interaction.user.id);
    const reason = interaction.fields.getTextInputValue("reason");
    const member = await interaction.guild.members.fetch(data.target);
    const role = interaction.guild.roles.cache.get(ROLES[data.type].id);

    if (role) await member.roles.add(role);

    const now = Date.now();
    const endTime = data.duration ? now + data.duration : null;
    activeWarnings.set(member.id, { typeName: ROLES[data.type].name, endTime });

    const embed = new EmbedBuilder()
      .setTitle("🚨 تم إعطاء عقوبة")
      .setColor(0xFF4C4C)
      .addFields(
        { name: "👤 المستخدم", value: `<@${member.id}>`, inline: true },
        { name: "👮 الإداري", value: `<@${interaction.user.id}>`, inline: true },
        { name: "📋 العقوبة", value: ROLES[data.type].name },
        { name: "⏱ المدة", value: data.duration ? getReadableDuration(data.duration) : "دائم", inline: true },
        { name: "📝 السبب", value: reason }
      )
      .setTimestamp();

    const log = interaction.guild.channels.cache.get(LOG_CHANNEL);
    if (log) log.send({ embeds: [embed] });

    if (data.duration) {
      schedule.scheduleJob(Date.now() + data.duration, async () => {
        if (role && member.roles.cache.has(role.id)) await member.roles.remove(role);
        if (log) log.messages.fetch({ limit: 50 }).then(msgs => {
          const message = msgs.find(m => m.embeds[0]?.title === "🚨 تم إعطاء عقوبة" && m.embeds[0].data.fields[0].value.includes(member.id));
          if (message) message.delete().catch(() => {});
        });
        activeWarnings.delete(member.id);
      });
    }

    await interaction.editReply({ content: "✅ تم تنفيذ العقوبة" });
    temp.delete(interaction.user.id);
  }
});

function showReasonModal(interaction) {
  const modal = new ModalBuilder().setCustomId("reasonModal").setTitle("سبب العقوبة");
  const input = new TextInputBuilder().setCustomId("reason").setLabel("اكتب السبب").setStyle(TextInputStyle.Paragraph).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function getReadableDuration(ms) {
  if (ms < 60*1000) return Math.ceil(ms/1000) + " ثانية";
  if (ms < 60*60*1000) return Math.ceil(ms/60000) + " دقيقة";
  if (ms < 24*60*60*1000) return Math.ceil(ms/3600000) + " ساعة";
  return Math.ceil(ms/86400000) + " يوم";
}

client.login(TOKEN);
