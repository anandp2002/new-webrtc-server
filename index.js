import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Check if room exists
  socket.on('check-room', ({ roomId }) => {
    const roomExists = rooms.hasOwnProperty(roomId);
    socket.emit('room-exists', { exists: roomExists });
  });

  // Create a new room
  socket.on('create-room', ({ roomId }) => {
    if (rooms.hasOwnProperty(roomId)) {
      // If room already exists, don't re-create it, just acknowledge
      console.warn(`Attempted to create room ${roomId} which already exists.`);
    } else {
      rooms[roomId] = []; // Initialize an empty array for the room participants
    }
    // We are not joining the socket to the room here during 'create-room'
    // The client will explicitly call 'join-room' after creating.
    console.log(`Room created: ${roomId} (not joined yet by creator)`);
    socket.emit('room-created', { roomId }); // Acknowledge creation
  });

  socket.on('join-room', ({ roomId }) => {
    if (!rooms[roomId]) {
      socket.emit('room-not-found');
      return;
    }

    // Add user to the room if not already there
    if (!rooms[roomId].includes(socket.id)) {
      rooms[roomId].push(socket.id);
    }
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);

    const otherUsers = rooms[roomId].filter((id) => id !== socket.id);
    socket.emit('all-users', otherUsers);

    socket.to(roomId).emit('user-joined', socket.id);

    socket.on('offer', (payload) => {
      io.to(payload.target).emit('offer', {
        sdp: payload.sdp,
        caller: socket.id,
      });
    });

    socket.on('answer', (payload) => {
      io.to(payload.target).emit('answer', {
        sdp: payload.sdp,
        caller: socket.id,
      });
    });

    socket.on('ice-candidate', (payload) => {
      io.to(payload.target).emit('ice-candidate', {
        candidate: payload.candidate,
        from: socket.id,
      });
    });

    socket.on('disconnect', () => {
      if (rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        socket.to(roomId).emit('user-disconnected', socket.id);

        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} has been deleted (empty)`);
        }
      }
    });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId].includes(socket.id)) {
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        socket.to(roomId).emit('user-disconnected', socket.id);

        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} has been deleted (empty)`);
        }
      }
    });
  });
});

server.listen(5000, () => console.log('Server running on port 5000'));
