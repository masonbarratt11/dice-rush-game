const express = require('express');
const { Telegraf } = require('telegraf');
require('dotenv').config();
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const players = {};
const activeMatches = {};
const diceRolls = {}; // Store dice rolls: userId -> value

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username || `User_${userId}`;
  if (!players[userId]) {
    players[userId] = { username, balance: 100, wins: 0, losses: 0 };
  }
  await ctx.reply(`🎲 Welcome to DICE RUSH!\n\nYour balance: $${players[userId].balance}`, {
    reply_markup: {
      inline_keyboard: [[{ text: '🎮 Play Game', url: process.env.GAME_URL || 'http://localhost:3001/game' }]]
    }
  });
});

// Listen for dice messages
bot.on('dice', async (ctx) => {
  const userId = ctx.from.id;
  const diceValue = ctx.message.dice.value; // Gets 1-6
  diceRolls[userId] = diceValue;
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
    telegramId,
    betAmount,
    playerRoll: null,
    botRoll: null,
    winner: null
  };
  res.json({ matchId, opponent: 'Bot', betAmount, pot: betAmount * 2 });
});

app.post('/api/match/:matchId/roll', (req, res) => {
  const match = activeMatches[req.params.matchId];
  if (!match) return res.status(404).json({ error: 'Not found' });

  const playerRoll = req.body.roll; // 1-6 from Telegram dice

  // Bot rolls - guarantee different number
  const available = [1, 2, 3, 4, 5, 6].filter(n => n !== playerRoll);
  const botRoll = available[Math.floor(Math.random() * available.length)];

  match.playerRoll = playerRoll;
  match.botRoll = botRoll;

  // Winner: 65% bot, 35% player
  const winner = Math.random() < 0.65 ? 2 : 1;
  match.winner = winner;

  const prize = match.betAmount * 2 * 0.97;
  if (winner === 1) {
    players[req.body.telegramId].balance += prize;
    players[req.body.telegramId].wins++;
  }

  return res.json({
    matchComplete: true,
    winner,
    prize: prize.toFixed(2),
    playerRoll,
    botRoll,
    newBalance: winner === 1 ? players[req.body.telegramId].balance.toFixed(2) : '0'
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/game', (req, res) => {
  const apiBase = process.env.GAME_URL ? process.env.GAME_URL.replace('/game', '') : 'https://dice-rush-game-production.up.railway.app';
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>DICE RUSH</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:linear-gradient(135deg,#0f5f2f,#1a8c4d);color:white;font-family:Arial,sans-serif;padding:16px;min-height:100vh}.container{max-width:500px;margin:0 auto}h1{text-align:center;font-size:32px;margin-bottom:20px}h2{font-size:24px;color:#ffd700}.card{background:rgba(0,0,0,0.3);padding:16px;border-radius:8px;margin-bottom:12px;border:2px solid #00ff00}.balance{font-size:28px;font-weight:bold;color:#ffd700;text-align:center}button{width:100%;padding:14px;background:linear-gradient(135deg,#ff6b00,#ff8800);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;margin-bottom:10px;font-size:16px;transition:all 0.3s}button:hover{transform:scale(1.05);opacity:0.9}button:disabled{opacity:0.5;cursor:not-allowed}input{width:100%;padding:12px;background:#1a1a2e;border:2px solid #ffd700;color:white;border-radius:4px;margin-bottom:10px;font-size:16px}.hidden{display:none}.dice-display{display:flex;justify-content:center;gap:40px;margin:30px 0;font-size:80px;align-items:center}.dice-box{text-align:center;padding:20px;background:rgba(255,255,255,0.1);border-radius:8px;min-width:100px}.dice-value{font-size:48px;color:#ffd700;margin-top:10px;font-weight:bold}.vs-text{font-size:28px;color:#ffd700}#result{font-size:24px;font-weight:bold;margin:20px 0;text-align:center;min-height:40px}.end-message{text-align:center;padding:20px;background:rgba(255,215,0,0.1);border-radius:8px;margin-top:20px}.prize-text{color:#00ff00;font-size:20px;font-weight:bold}.info{background:rgba(0,0,0,0.5);padding:12px;border-radius:4px;margin-bottom:12px;font-size:12px;color:#888}</style></head><body><div class="container"><h1>🎲 DICE RUSH</h1><div class="info">💡 Tip: Roll dice in Telegram chat, then submit your roll here!</div><div id="setup"><div class="card"><div style="color:#888;font-size:14px;margin-bottom:8px">💰 Balance</div><div class="balance" id="balance">$100.00</div></div><div class="card"><label style="color:#888;font-size:14px">Bet Amount:</label><input type="number" id="bet" value="5" min="1" max="100"><button onclick="startGame()">🤖 Play Bot</button></div></div><div id="game" class="hidden"><div class="card" style="text-align:center"><h2>Match: 0-0</h2><div style="color:#ffd700;margin-top:8px">vs Bot</div><div style="color:#888;font-size:12px;margin-top:8px">Pot: $<span id="pot">0</span></div></div><div class="card"><div style="color:#ffd700;text-align:center;margin-bottom:20px;font-size:18px">Round 1</div><div class="dice-display"><div class="dice-box"><span id="p1dice">?</span><div class="dice-value" id="p1val"></div></div><div class="vs-text">vs</div><div class="dice-box"><span id="p2dice">🎲</span><div class="dice-value" id="p2val"></div></div></div><div id="result"></div><div class="info">📱 Roll a dice 🎲 in your Telegram chat, then click "Submit Roll"</div></div><button id="rollBtn" onclick="roll()" style="background:linear-gradient(135deg,#ff6b00,#ff8800)">📤 Submit Roll</button><button id="againBtn" onclick="again()" class="hidden" style="background:linear-gradient(135deg,#7c3aed,#a855f7)">Play Again</button><div id="endDiv" class="card hidden"><div class="end-message"><h2 id="endTitle"></h2><div class="prize-text" id="endPrize"></div></div></div></div></div></div><script>const API="${apiBase}";let tid=Math.random().toString(),mid=null;async function startGame(){const bet=parseFloat(document.getElementById('bet').value);if(isNaN(bet)||bet<1){alert('Please enter a valid bet');return}try{const r=await fetch(API+'/api/match/vs-bot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:tid,username:'Player',betAmount:bet})});const d=await r.json();if(d.matchId){mid=d.matchId;document.getElementById('setup').classList.add('hidden');document.getElementById('game').classList.remove('hidden');document.getElementById('pot').textContent=d.pot;document.getElementById('p1val').textContent='';document.getElementById('p2val').textContent='';document.getElementById('result').textContent=''}}catch(e){alert('Error: '+e.message)}}async function roll(){const roll=prompt('Enter your dice roll (1-6):');if(!roll)return;const playerRoll=parseInt(roll);if(isNaN(playerRoll)||playerRoll<1||playerRoll>6){alert('Please enter a valid number 1-6');return}document.getElementById('p1dice').textContent='🎲';document.getElementById('p1val').textContent=playerRoll;try{const res=await fetch(API+'/api/match/'+mid+'/roll',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:tid,roll:playerRoll})});const d=await res.json();document.getElementById('p2val').textContent=d.botRoll;if(d.playerRoll>d.botRoll){document.getElementById('result').innerHTML='<div style="color:#00ff00;font-size:20px">✓ You Won!</div>'}else{document.getElementById('result').innerHTML='<div style="color:#ff6b6b;font-size:20px">✗ Bot Won</div>'}document.getElementById('rollBtn').classList.add('hidden');document.getElementById('againBtn').classList.remove('hidden');document.getElementById('endDiv').classList.remove('hidden');document.getElementById('endTitle').textContent=d.winner===1?'🎉 YOU WON!':'😢 YOU LOST';document.getElementById('endPrize').textContent=d.winner===1?'Prize: $'+d.prize:'Better luck next time!';document.getElementById('balance').textContent='$'+d.newBalance}catch(e){alert('Error: '+e.message)}}function again(){document.getElementById('setup').classList.remove('hidden');document.getElementById('game').classList.add('hidden');document.getElementById('endDiv').classList.add('hidden');document.getElementById('rollBtn').classList.remove('hidden');document.getElementById('againBtn').classList.add('hidden');mid=null}</script></body></html>`);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('🎲 DICE RUSH running on port ' + PORT));

bot.launch({ allowedUpdates: ['message', 'callback_query'] }).catch(e => console.error(e));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
