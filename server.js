// server.js - DICE RUSH Backend Server (Complete)
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
    if (roundData.p1Roll > roundData.p2Roll) {
      roundData.winner = 1;
      match.player1Wins = (match.player1Wins || 0) + 1;
    } else if (roundData.p2Roll > roundData.p1Roll) {
      roundData.winner = 2;
      match.player2Wins = (match.player2Wins || 0) + 1;
    } else {
      roundData.winner = 0;
    }
    
    if ((match.player1Wins || 0) >= 2 || (match.player2Wins || 0) >= 2) {
      match.status = 'completed';
      const winner = (match.player1Wins || 0) >= 2 ? 1 : 2;
      const winnerId = winner === 1 ? match.player1.telegramId : match.player2.telegramId;
      const prize = match.betAmount * 2 * 0.97;
      
      players[winnerId].balance += prize;
      players[winnerId].wins += 1;
      
      const loserId = winner === 1 ? match.player2.telegramId : match.player1.telegramId;
      players[loserId].losses += 1;
      
      return res.json({
        matchComplete: true,
        winner,
        prize: prize.toFixed(2),
        newBalance: players[winnerId].balance.toFixed(2)
      });
    }
  }
  
  res.json({ roundData });
});

app.get('/api/match/:matchId', (req, res) => {
  const { matchId } = req.params;
  const match = activeMatches[matchId];
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = Object.values(players)
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10)
    .map((player, idx) => ({
      rank: idx + 1,
      username: player.username,
      wins: player.wins,
      balance: player.balance.toFixed(2)
    }));
  res.json(leaderboard);
});

app.get('/health', (req, res) => {
  res.json({ status: 'DICE RUSH server is running! 🎲' });
});

app.post('/webhook', (req, res) => {
  bot.handleUpdate(req.body);
  res.send('ok');
});

app.get('/game', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>DICE RUSH</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:linear-gradient(135deg,#0f5f2f,#1a8c4d);color:white;font-family:Arial,sans-serif;padding:16px;min-height:100vh}.container{max-width:400px;margin:0 auto}h1{text-align:center;font-size:32px;margin-bottom:20px}.card{background:rgba(0,0,0,0.3);padding:16px;border-radius:8px;margin-bottom:12px;border:1px solid #00ff00}.balance{font-size:24px;font-weight:bold;color:#ffd700}button{width:100%;padding:12px;background:linear-gradient(135deg,#ff6b00,#ff8800);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;margin-bottom:8px;font-size:14px}button:hover{opacity:0.9}.dice{font-size:48px;text-align:center;margin:16px 0}.input{width:100%;padding:10px;background:#1a1a2e;border:1px solid #ffd700;color:white;border-radius:4px;margin-bottom:8px;font-size:14px}</style></head><body><div class="container"><h1>🎲 DICE RUSH</h1><div class="card"><div style="font-size:12px;color:#888;margin-bottom:4px;">Balance</div><div class="balance" id="balance">$100.00</div></div><div class="card"><div style="font-size:12px;color:#ffd700;margin-bottom:8px;font-weight:bold;">Set Bet Amount</div><input type="number" id="betAmount" class="input" value="5" min="1" placeholder="Enter bet amount"><button onclick="findOpponent()">🎯 Find Opponent</button></div></div><script>let telegramId=Math.random();let matchId=null;async function findOpponent(){const betAmount=parseFloat(document.getElementById('betAmount').value);const response=await fetch('/api/match/find',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId,username:'Player',betAmount})});const data=await response.json();matchId=data.matchId;if(data.matchId){alert('Opponent found! Game ready.');}else{alert(data.message||'Searching for opponent...');}}</script></body></html>`);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🎲 DICE RUSH Server running on port ${PORT}`);
  console.log(`Game URL: http://localhost:${PORT}/game`);
});
