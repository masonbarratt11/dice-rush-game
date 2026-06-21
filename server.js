// server.js - DICE RUSH Backend Server (Fixed for Railway)
const express = require('express');
const { Telegraf } = require('telegraf');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Players storage
const players = {};
const waitingQueue = {};
const activeMatches = {};

// Telegram bot commands
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || `User_${userId}`;

  if (!players[userId]) {
    players[userId] = {
      username,
      balance: 100,
      wins: 0,
      losses: 0,
      joinedAt: new Date()
    };
  }

  await ctx.reply(`🎲 Welcome to DICE RUSH!\n\nYour balance: $${players[userId].balance}\n\nReady to roll?`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎮 Play Game', web_app: { url: process.env.GAME_URL || 'http://localhost:3001/game' } }],
        [{ text: '💰 Buy Coins', callback_data: 'buy_coins' }],
        [{ text: '📊 Stats', callback_data: 'stats' }]
      ]
    }
  });
});

bot.command('balance', (ctx) => {
  const userId = ctx.from.id;
  const balance = players[userId]?.balance || 0;
  ctx.reply(`💰 Your Balance: $${balance.toFixed(2)}`);
});

bot.command('stats', (ctx) => {
  const userId = ctx.from.id;
  const player = players[userId];
  if (!player) return ctx.reply('Not registered yet. Send /start first.');

  const stats = `📊 YOUR STATS\n═══════════════\nUsername: ${player.username}\nBalance: $${player.balance.toFixed(2)}\nWins: ${player.wins}\nLosses: ${player.losses}\nWin Rate: ${player.wins + player.losses > 0 ? ((player.wins / (player.wins + player.losses)) * 100).toFixed(1) : 0}%`;
  ctx.reply(stats);
});

bot.action('buy_coins', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply('💳 Buy coins coming soon!', {
    reply_markup: {
      inline_keyboard: [[{ text: '🎮 Play Game', web_app: { url: process.env.GAME_URL } }]]
    }
  });
});

bot.action('stats', (ctx) => {
  const userId = ctx.from.id;
  const player = players[userId];
  ctx.answerCbQuery();
  const stats = `📊 YOUR STATS\n═══════════════\nUsername: ${player?.username}\nBalance: $${player?.balance.toFixed(2)}\nWins: ${player?.wins}\nLosses: ${player?.losses}`;
  ctx.reply(stats);
});

// API Endpoints
app.get('/api/player/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  const player = players[telegramId];
  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json(player);
});

app.post('/api/match/find', (req, res) => {
  const { telegramId, username, betAmount } = req.body;
  if (!players[telegramId]) return res.status(400).json({ error: 'Player not registered' });
  if (players[telegramId].balance < betAmount) return res.status(400).json({ error: 'Insufficient balance' });
  if (!waitingQueue[betAmount]) waitingQueue
