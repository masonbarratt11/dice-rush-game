const express = require('express');
const { Telegraf } = require('telegraf');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const players = {};
const waitingQueue = {};
const activeMatches = {};

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || `User_${userId}`;
  if (!players[userId]) {
    players[userId] = { username, balance: 100, wins: 0, losses: 0, joinedAt: new Date() };
  }
  await ctx.reply(`🎲 Welcome to DICE RUSH!\n\nYour balance: $${players[userId].balance}`, {
    reply_markup: {
      inline_keyboard: [[{ text: '🎮 Play Game', url: process.env.GAME_URL || 'http://localhost:3001/game' }]]
    }
  });
});

app.post('/api/match/vs-bot', (req, res) => {
  const { telegramId, username, betAmount } = req.body;
  if (!players[telegramId]) {
    players[telegramId] = { username: username || 'Player', balance: 100, wins: 0, losses: 0 };
  }
  if (players[telegramId].balance < betAmount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  const matchId = `match_${Date.now()}`;
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
    player2Wins: 0
  };
  res.json({ matchId, opponent: 'Bot', betAmount, pot: betAmount * 2, isBot: true });
});

app.get('/api/match/:matchId', (req, res) => {
  const match = activeMatches[req.params.matchId];
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
});

app.post('/api/match/:matchId/roll', (req, res) => {
  const { matchId } = req.params;
  const { telegramId, roll } = req.body;
  const match = activeMatches[matchId];
  
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (roll < 1 || roll > 6) return res.status(400).json({ error: 'Invalid roll' });
  
  const roundNum = match.rounds.length + 1;
  let roundData = match.rounds[roundNum - 1];
  
  if (!roundData) {
    roundData = { round: roundNum, p1Roll: null, p2Roll: null, winner: null };
    match.rounds.push(roundData);
  }
  
  if (match.player1.telegramId === telegramId) {
    roundData.p1Roll = roll;
  }
  
  if (match.isBot && roundData.p1Roll && !roundData.p2Roll) {
    roundData.p2Roll = Math.floor(Math.random() * 6) + 1;
  }
  
  if (roundData.p1Roll && roundData.p2Roll) {
    if (roundData.p1Roll > roundData.p2Roll) {
      roundData.winner = 1;
      match.player1Wins++;
    } else if (roundData.p2Roll > roundData.p1Roll) {
      roundData.winner = 2;
      match.player2Wins++;
    } else {
      roundData.winner = 0;
    }
    
    if (match.player1Wins >= 2 || match.player2Wins >= 2) {
      match.status = 'completed';
      const winner = match.player1Wins >= 2 ? 1 : 2;
      const winnerId = winner === 1 ? match.player1.telegramId : 'bot';
      const prize = match.betAmount * 2 * 0.97;
      
      if (winnerId !== 'bot') {
        players[winnerId].balance += prize;
        players[winnerId].wins++;
      }
      
      return res.json({
        matchComplete: true,
        winner,
        prize: prize.toFixed(2),
        newBalance: winnerId !== 'bot' ? players[winnerId].balance.toFixed(2) : '0'
      });
    }
  }
  
  res.json({ roundData, match });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/game', (req, res) => {
  const apiBase = process.env.GAME_URL ? process.env.GAME_URL.replace('/game', '') : 'https://dice-rush-game-production.up.railway.app';
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DICE RUSH</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: linear-gradient(135deg,#0f5f2f,#1a8c4d); color: white; font-family: Arial; padding: 16px; min-height: 100vh; }
    .container { max-width: 500px; margin: 0 auto; }
    h1 { text-align: center; font-size: 28px; margin-bottom: 20px; }
    .card { background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #00ff00; }
    .balance { font-size: 24px; font-weight: bold; color: #ffd700; }
    button { width: 100%; padding: 12px; background: linear-gradient(135deg,#ff6b00,#ff8800); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 8px; font-size: 14px; }
    button:hover { opacity: 0.9; }
    button.purple { background: linear-gradient(135deg,#7c3aed,#a855f7); }
    input { width: 100%; padding: 10px; background: #1a1a2e; border: 1px solid #ffd700; color: white; border-radius: 4px; margin-bottom: 8px; font-size: 14px; }
    .hidden { display: none; }
    .dice-container { display: flex; justify-content: center; gap: 20px; margin: 20px 0; }
    .dice { width: 80px; height: 80px; background: white; border: 2px solid #333; border-radius: 6px; display: grid; grid-template-columns: repeat(3,1fr); padding: 6px; gap: 3px; }
    .pip { width: 12px; height: 12px; background: red; border-radius: 50%; }
    .pip.empty { background: transparent; }
    .vs { font-size: 18px; color: #ffd700; font-weight: bold; align-self: center; }
  </style>
</head>
<body>
<div class="container">
  <h1>🎲 DICE RUSH</h1>
  <div id="setup">
    <div class="card"><div style="color:#888;font-size:12px;">Balance</div><div class="balance" id="balance">$100.00</div></div>
    <div class="card">
      <input type="number" id="bet" value="5" min="1" placeholder="Bet amount">
      <button onclick="startBot()">🤖 Play Bot</button>
    </div>
  </div>
  <div id="game" class="hidden">
    <div class="card" style="text-align:center;"><h2 id="status">Match: 0-0</h2><div id="opponent" style="color:#ffd700;margin-top:8px;">vs Bot</div><div style="color:#888;font-size:12px;margin-top:8px;">Pot: $<span id="pot">0</span></div></div>
    <div class="card" style="text-align:center;">
      <div style="color:#ffd700;font-size:12px;margin-bottom:8px;">Round <span id="round">1</span>/3</div>
      <div class="dice-container">
        <div class="dice" id="d1"><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div></div>
        <div class="vs">vs</div>
        <div class="dice" id="d2"><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div><div class="pip empty"></div></div>
      </div>
      <div id="result" style="margin-top:12px;color:#00ff00;font-weight:bold;"></div>
    </div>
    <button id="rollBtn" onclick="roll()">🎲 Roll</button>
    <button id="nextBtn" onclick="nextRound()" class="hidden">→ Next</button>
    <div id="end" class="card hidden" style="text-align:center;"><h2 id="endText"></h2><div id="prize" style="color:#ffd700;margin-top:8px;"></div><button onclick="playAgain()" class="purple">Play Again</button></div>
  </div>
</div>
<script>
const API = "${apiBase}";
let tid = Math.random().toString();
let mid = null;
let match = null;

function getDice(n) {
  const p = [0,0,0,0,0,0,0,0,0];
  if(n===1) p[4]=1;
  else if(n===2) { p[0]=1; p[8]=1; }
  else if(n===3) { p[0]=1; p[4]=1; p[8]=1; }
  else if(n===4) { p[0]=1; p[2]=1; p[6]=1; p[8]=1; }
  else if(n===5) { p[0]=1; p[2]=1; p[4]=1; p[6]=1; p[8]=1; }
  else if(n===6) { p[0]=1; p[2]=1; p[3]=1; p[5]=1; p[6]=1; p[8]=1; }
  return p;
}

function showDice(id, n) {
  const p = getDice(n);
  const pips = document.getElementById(id).querySelectorAll('.pip');
  pips.forEach((pip, i) => {
    pip.className = 'pip' + (p[i] ? '' : ' empty');
  });
}

async function startBot() {
  const bet = parseFloat(document.getElementById('bet').value);
  try {
    const res = await fetch(API + '/api/match/vs-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: tid, username: 'Player', betAmount: bet })
    });
    const data = await res.json();
    if(data.matchId) {
      mid = data.matchId;
      document.getElementById('setup').classList.add('hidden');
      document.getElementById('game').classList.remove('hidden');
      document.getElementById('pot').textContent = data.pot;
      loadMatch();
    }
  } catch(e) { alert('Error: ' + e.message); }
}

async function loadMatch() {
  try {
    const res = await fetch(API + '/api/match/' + mid);
    match = await res.json();
    updateUI();
  } catch(e) { console.error(e); }
}

async function roll() {
  const n = Math.floor(Math.random()*6)+1;
  try {
    const res = await fetch(API + '/api/match/' + mid + '/roll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: tid, roll: n })
    });
    const data = await res.json();
    match = data.match;
    updateUI();
    if(data.matchComplete) { endGame(data); }
    else { document.getElementById('rollBtn').classList.add('hidden'); document.getElementById('nextBtn').classList.remove('hidden'); }
  } catch(e) { alert('Error: ' + e.message); }
}

function nextRound() {
  document.getElementById('rollBtn').classList.remove('hidden');
  document.getElementById('nextBtn').classList.add('hidden');
  showDice('d1', 0);
  showDice('d2', 0);
  document.getElementById('result').textContent = '';
}

function updateUI() {
  if(!match || !match.rounds || match.rounds.length === 0) return;
  const r = match.rounds[match.rounds.length-1];
  if(r) {
    document.getElementById('round').textContent = r.round;
    if(r.p1Roll) showDice('d1', r.p1Roll);
    if(r.p2Roll) showDice('d2', r.p2Roll);
    if(r.winner === 1) document.getElementById('result').textContent = '✓ You won!';
    else if(r.winner === 2) document.getElementById('result').textContent = '✗ Bot won';
    else document.getElementById('result').textContent = '= Tie!';
  }
  document.getElementById('status').textContent = 'Match: ' + (match.player1Wins||0) + '-' + (match.player2Wins||0);
}

function endGame(data) {
  document.getElementById('rollBtn').classList.add('hidden');
  document.getElementById('nextBtn').classList.add('hidden');
  document.getElementById('game').querySelector('.card:nth-child(2)').classList.add('hidden');
  document.getElementById('end').classList.remove('hidden');
  document.getElementById('endText').textContent = data.winner === 1 ? '🎉 YOU WON!' : '😢 YOU LOST';
  document.getElementById('prize').textContent = data.winner === 1 ? 'Prize: $' + data.prize : 'Better luck next time!';
  document.getElementById('balance').textContent = '$' + data.newBalance;
}

function playAgain() {
  document.getElementById('setup').classList.remove('hidden');
  document.getElementById('game').classList.add('hidden');
  document.getElementById('game').querySelector('.card:nth-child(2)').classList.remove('hidden');
  document.getElementById('end').classList.add('hidden');
  mid = null;
  match = null;
}
</script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('DICE RUSH on port ' + PORT));

bot.launch({ allowedUpdates: ['message', 'callback_query'] }).catch(e => console.error(e));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
