const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;

// 1. Static files serve karne ke liye
app.use(express.static(path.join(__dirname)));

// 2. Default Routes (Browser mein error na aaye isliye)
app.get('/', (req, res) => {
    // Agar aapki main file index.html hai, to use serve karega
    res.sendFile(path.join(__dirname, 'index.html')); 
});

app.get('/player', (req, res) => {
    res.sendFile(path.join(__dirname, 'player.html'));
});

const rooms = new Map();

function send(ws, obj) {
  try { 
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj)); 
    }
  } catch (e) { console.error("Send error:", e); }
}

function broadcastToRoom(roomId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.host) send(room.host, message);
  for (const [, p] of room.players.entries()) {
    send(p.ws, message);
  }
}

wss.on('connection', (ws) => {
  ws.id = uuidv4();

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }

    const { type, payload } = msg;

    // 1. JOIN LOGIC
    if (type === 'join') {
      const { role, roomId, name } = payload || {};
      ws.role = role;
      ws.roomId = roomId;
      ws.name = name || (role === 'host' ? 'Host' : `Player-${ws.id.slice(0,4)}`);

      if (!rooms.has(roomId)) {
        rooms.set(roomId, { host: null, players: new Map() });
      }
      const room = rooms.get(roomId);

      if (role === 'host') {
        room.host = ws;
        send(ws, { type: 'joined', payload: { role: 'host', roomId } });
      } else {
        room.players.set(ws.id, { ws, name: ws.name, score: 0 });
        send(ws, { type: 'joined', payload: { role: 'player', roomId, playerId: ws.id } });
        if (room.host) send(room.host, { type: 'player_joined', payload: { playerId: ws.id, name: ws.name } });
      }
      return;
    }

    // 2. HOST FEEDBACK
    if (type === 'host_feedback_to_player') {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const targetPlayer = room.players.get(payload.playerId);
      if (targetPlayer) {
          send(targetPlayer.ws, { type: 'host_feedback', payload: { result: payload.result } });
      }
      return;
    }

    // 3. SEND QUESTION
    if (type === 'send_question') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'host') return;
      broadcastToRoom(ws.roomId, { type: 'question', payload: payload });
      return;
    }

    // 4. SCORE UPDATE
    if (type === 'score_update') {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const pId = payload.playerId;
      const playerEntry = room.players.get(pId);
      if (playerEntry) {
        playerEntry.score += (payload.delta || 0);
        const scoreboard = Array.from(room.players.entries()).map(([pid, p]) => ({
          playerId: pid,
          name: p.name,
          score: p.score
        }));
        broadcastToRoom(ws.roomId, { type: 'scoreboard', payload: scoreboard });
      }
      return;
    }

    // 5. PLAYER ANSWER
    if (type === 'player_answer') {
      const room = rooms.get(ws.roomId);
      if (room && room.host) {
        send(room.host, { 
          type: 'player_answer', 
          payload: { playerId: ws.id, name: ws.name, answer: payload.answer } 
        });
      }
      return;
    }

    // 6. LIST PLAYERS
    if (type === 'list_players') {
      const room = rooms.get(ws.roomId);
      if (room) {
        const players = Array.from(room.players.entries()).map(([pid, p]) => ({
          playerId: pid,
          name: p.name,
          score: p.score
        }));
        send(ws, { type: 'players', payload: players });
      }
      return;
    }
    
    // 7. LIFELINE
    if (type === 'lifeline_5050') {
      broadcastToRoom(ws.roomId, { type: 'lifeline_5050', payload });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (room && ws.role === 'player') {
      room.players.delete(ws.id);
      if (room.host) send(room.host, { type: 'player_left', payload: { playerId: ws.id } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});