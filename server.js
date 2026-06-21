// server.js - DICE RUSH Backend Server
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

  const stats = `
📊 YOUR STATS
═══════════════
Username: ${player.username}
Balance: $${player.balance.toFixed(2)}
Wins: ${player.wins}
Losses: ${player.losses}
Win Rate: ${player.wins + player.losses > 0 ? ((player.wins / (player.wins + player.losses)) * 100).toFixed(1) : 0}%
  `;
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

  if (!waitingQueue[betAmount]) waitingQueue[betAmount] = [];

  if (waitingQueue[betAmount].length > 0) {
    const opponent = waitingQueue[betAmount].pop();
    const matchId = `match_${Date.now()}`;

    players[telegramId].balance -= betAmount;
    players[opponent.telegramId].balance -= betAmount;

    activeMatches[matchId] = {
      matchId,
      player1: { telegramId, username },
      player2: opponent,
      betAmount,
      rounds: [],
      status: 'active',
      createdAt: new Date()
    };

    return res.json({
      matchId,
      opponent: opponent.username,
      betAmount,
      pot: betAmount * 2
    });
  } else {
    waitingQueue[betAmount].push({ telegramId, username });
    return res.json({
      status: 'waiting',
      message: `Waiting for opponent at bet $${betAmount}...`,
      queueLength: waitingQueue[betAmount].length
    });
  }
});

app.post('/api/match/:matchId/roll', (req, res) => {
  const { matchId } = req.params;
  const { telegramId, roll } = req.body;

  const match = activeMatches[matchId];
  if (!match) return res.status(404).json({ error: 'Match not found' });

  if (roll < 1 || roll > 6) return res.status(400).json({ error: 'Invalid roll' });

  const isPlayer1 = match.player1.telegramId === telegramId;
  if (!isPlayer1 && match.player2.telegramId !== telegramId) {
    return res.status(403).json({ error: 'Not part of this match' });
  }

  const roundNum = match.rounds.length + 1;
  let roundData = match.rounds[roundNum - 1];

  if (!roundData) {
    roundData = { round: roundNum, p1Roll: null, p2Roll: null, winner: null };
    match.rounds.push(roundData);
  }

  if (isPlayer1) {
    roundData.p1Roll = roll;
  } else {
    roundData.p2Roll = roll;
  }

  if (roundData.p1Roll !== null && roundData.p2Roll !== null) {
    if (roundData.p1Roll >