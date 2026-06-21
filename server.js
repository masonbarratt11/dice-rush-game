// server.js - DICE RUSH Complete Game
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
        [{ text: '🎮 Play Game', url: process.env.GAME_URL || 'http://localhost:3001/game' }],
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
      inline_keyboard: [[{ text: '🎮 Play Game', url: process.env.GAME_URL }]]
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
  
  if (!players[telegramId]) {
    players[telegramId] = {
      username: username || `User_${telegramId}`,
      balance: 100,
      wins: 0,
      losses: 0,
      joinedAt: new Date()
    };
  }
  
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
      isBot: false,
      createdAt: new Date()
    };
    
    return res.json({
      matchId,
      opponent: opponent.username,
      betAmount,
      pot: betAmount * 2,
      isBot: false
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

app.post('/api/match/vs-bot', (req, res) => {
  const { telegramId, username, betAmount } = req.body;
  
  if (!players[telegramId]) {
    players[telegramId] = {
      username: username || `User_${telegramId}`,
      balance: 100,
      wins: 0,
      losses: 0,
      joinedAt: new Date()
    };
  }
  
  if (players[telegramId].balance < betAmount) return res.status(400).json({ error: 'Insufficient balance' });
  
  const matchId = `match_bot_${Date.now()}`;
  players[telegramId].balance -= betAmount;
  
  activeMatches[matchId] = {
    matchId,
    player1: { telegramId, username },
    player2: { telegramId: 'bot', username: 'Bot' },
    betAmount,
    rounds: [],
    status: 'active',
    isBot: true,
    player1Wins: 0,
    player2Wins: 0,
    createdAt: new Date()
  };
  
  return res.json({
    matchId,
    opponent: 'Bot',
    betAmount,
    pot: betAmount * 2,
    isBot: true
  });
});

app.get('/api/match/:matchId', (req, res) => {
  const { matchId } = req.params;
  const match = activeMatches[matchId];
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
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
  
  if (match.isBot && isPlayer1 && roundData.p2Roll === null) {
    roundData.p2Roll = Math.floor(Math.random() * 6) + 1;
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
      
      if (winnerId !== 'bot') {
        players[winnerId].balance += prize;
        players[winnerId].wins += 1;
      }
      
      const loserId = winner === 1 ? match.player2.telegramId : match.player1.telegramId;
      if (loserId !== 'bot' && winnerId !== loserId) {
        players[loserId].losses += 1;
      }
      
      return res.json({
        matchComplete: true,
        winner,
        prize: prize.toFixed(2),
        newBalance: winnerId !== 'bot' ? players[winnerId].balance.toFixed(2) : '0',
        match: match
      });
    }
  }
  
  res.json({ roundData, match: match });
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
  res.json({ status: 'DICE RUSH running!' });
});

app.get('/game', (req, res) => {
  const apiBase = process.env.GAME_URL ? process.env.GAME_URL.replace('/game', '') : 'https://dice-rush-game-production.up.railway.app';
  const html = '<!DOCTYPE html><html><head><title>DICE RUSH</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:linear-gradient(135deg,#0f5f2f,#1a8c4d);color:white;font-family:Arial,sans-serif;padding:16px;min-height:100vh}.container{max-width:500px;margin:0 auto}h1{text-align:center;font-size:28px;margin-bottom:16px}h2{font-size:20px;text-align:center}.card{background:rgba(0,0,0,0.3);padding:16px;border-radius:8px;margin-bottom:12px;border:1px solid #00ff00}.balance{font-size:20px;font-weight:bold;color:#ffd700}button{width:100%;padding:12px;background:linear-gradient(135deg,#ff6b00,#ff8800);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;margin-bottom:8px;font-size:14px}button:hover{opacity:0.9}button.bot-btn{background:linear-gradient(135deg,#7c3aed,#a855f7)}.input{width:100%;padding:10px;background:#1a1a2e;border:1px solid #ffd700;color:white;border-radius:4px;margin-bottom:8px;font-size:14px}.hidden{display:none}.match-info{text-align:center;margin:16px 0}.round{text-align:center;margin:12px 0;padding:12px;background:rgba(0,0,0,0.5);border-radius:4px}.dice{font-size:48px;margin:8px 0;color:#ffd700}.vs{font-size:14px;color:#ffd700;margin:8px 0}.winner{color:#00ff00;font-weight:bold}.loser{color:#ff6b00}</style></head><body><div class="container"><h1>🎲 DICE RUSH</h1><div id="setupScreen" class="setup"><div class="card"><div style="font-size:12px;color:#888;margin-bottom:4px;">Balance</div><div class="balance" id="balance">$100.00</div></div><div class="card"><div style="font-size:12px;color:#ffd700;margin-bottom:8px;font-weight:bold;">Set Bet Amount</div><input type="number" id="betAmount" class="input" value="5" min="1" placeholder="Enter bet amount"><button onclick="findOpponent()">🎯 Find Opponent</button><button class="bot-btn" onclick="playBot()">🤖 Play Bot</button></div></div><div id="gameScreen" class="gameplay hidden"><div class="card match-info"><h2 id="matchStatus">Match: 0-0</h2><div style="font-size:14px;color:#ffd700;margin-top:8px;"><span id="player1Name">You</span> vs <span id="player2Name">Opponent</span></div><div style="font-size:12px;color:#888;margin-top:8px;">Pot: $<span id="potAmount">0</span></div></div><div id="roundDisplay" class="card"><div class="round"><div style="font-size:12px;color:#ffd700;">Round <span id="roundNum">1</span>/3</div><div class="dice" id="p1Dice">?</div><div class="vs">vs</div><div class="dice" id="p2Dice">?</div><div id="roundResult" style="margin-top:8px;color:#00ff00;"></div></div></div><button id="rollBtn" onclick="rollDice()">🎲 Roll Dice</button><button id="nextBtn" onclick="nextRound()" class="hidden">→ Next Round</button><div id="matchResult" class="card hidden" style="text-align:center;"><h2 id="resultText"></h2><div id="prizeText" style="margin-top:8px;font-size:16px;color:#ffd700;"></div><button id="playAgainBtn" onclick="playAgain()" class="bot-btn">🎮 Play Again</button></div></div></div><script>const API_BASE="' + apiBase + '";let telegramId=Math.random().toString();let matchId=null;let currentMatch=null;let isBot=false;async function findOpponent(){const betAmount=parseFloat(document.getElementById("betAmount").value);const apiUrl=API_BASE+"/api/match/find";try{const response=await fetch(apiUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegramId:telegramId,username:"Player",betAmount:betAmount})});const data=await response.json();if(data.matchId){matchId=data.matchId;isBot=false;startGame(data);}else{alert(data.message||"Searching for opponent...");}}catch(error){alert("Error: "+error.message);}}async function playBot(){const betAmount=parseFloat(document.getElementById("betAmount").value);const apiUrl=API_BASE+"/api/match/vs-bot";try{const response=await fetch(apiUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegramId:telegramId,username:"Player",betAmount:betAmount})});const data=await response.json();if(data.matchId){matchId=data.matchId;isBot=true;startGame(data);}else{alert("Error: "+(data.error||"Could not start bot match"));}}catch(error){alert("Error: "+error.message);}}function startGame(data){document.getElementById("setupScreen").classList.add("hidden");document.getElementById("gameScreen").classList.remove("hidden");document.getElementById("player1Name").textContent="You";document.getElementById("player2Name").textContent=data.opponent;document.getElementById("potAmount").textContent=data.pot;loadMatch();}async function loadMatch(){try{const response=await fetch(API_BASE+"/api/match/"+matchId);currentMatch=await response.json();updateDisplay();}catch(error){console.error("Error loading match:",error);}}async function rollDice(){const roll=Math.floor(Math.random()*6)+1;try{const response=await fetch(API_BASE+"/api/match/"+matchId+"/roll",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({telegramId:telegramId,roll:roll})});const data=await response.json();currentMatch=data.match;updateDisplay();if(data.matchComplete){showResult(data);}else{document.getElementById("rollBtn").classList.add("hidden");document.getElementById("nextBtn").classList.remove("hidden");}}catch(error){alert("Error: "+error.message);}}function nextRound(){document.getElementById("rollBtn").classList.remove("hidden");document.getElementById("nextBtn").classList.add("hidden");document.getElementById("p1Dice").textContent="?";document.getElementById("p2Dice").textContent="?";document.getElementById("roundResult").textContent="";}function updateDisplay(){const lastRound=currentMatch.rounds[currentMatch.rounds.length-1];if(lastRound){document.getElementById("roundNum").textContent=lastRound.round;if(lastRound.p1Roll)document.getElementById("p1Dice").textContent=lastRound.p1Roll;if(lastRound.p2Roll)document.getElementById("p2Dice").textContent=lastRound.p2Roll;if(lastRound.winner===1){document.getElementById("roundResult").textContent="✓ You won this round!";}else if(lastRound.winner===2){document.getElementById("roundResult").textContent="✗ Opponent won this round";}else{document.getElementById("roundResult").textContent="= Tie!";}}}function showResult(data){document.getElementById("rollBtn").classList.add("hidden");document.getElementById("nextBtn").classList.add("hidden");document.getElementById("roundDisplay").classList.add("hidden");document.getElementById("matchResult").classList.remove("hidden");const result=data.winner===1?"🎉 YOU WON!":"😢 YOU LOST";document.getElementById("resultText").textContent=result;document.getElementById("prizeText").textContent=data.winner===1?"Prize: $"+data.prize:"Better luck next time!";document.getElementById("balance").textContent="$"+data.newBalance;}function playAgain(){document.getElementById("setupScreen").classList.remove("hidden");document.getElementById("gameScreen").classList.add("hidden");document.getElementById("roundDisplay").classList.remove("hidden");document.getElementById("matchResult").classList.add("hidden");matchId=null;currentMatch=null;}</script></body></html>';
  res.send(html);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log('DICE RUSH running on port ' + PORT);
});

bot.launch({ allowedUpdates: ['message', 'callback_query'] }).catch(err => console.error(err));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
