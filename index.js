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

// This object will store the video status for each user in each room.
// Structure: { roomId: { userId: boolean (isVideoEnabled), ... }, ... }
const userVideoStates = {};

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
      userVideoStates[roomId] = {}; // Initialize video states for the new room
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
      // Set initial video state for the joining user to true (assuming video is on by default)
      userVideoStates[roomId][socket.id] = true;
    }
    socket.join(roomId);
    console.log(`User ${socket.id} joined room: ${roomId}`);

    const otherUsers = rooms[roomId].filter((id) => id !== socket.id);
    socket.emit('all-users', otherUsers);

    // Send initial video states of all other users to the newly joined user
    const currentRoomVideoStates = {};
    otherUsers.forEach((userId) => {
      currentRoomVideoStates[userId] = userVideoStates[roomId][userId];
    });
    socket.emit('initial-video-states', currentRoomVideoStates);

    socket.to(roomId).emit('user-joined', socket.id);

    // Handle WebRTC offer
    socket.on('offer', (payload) => {
      io.to(payload.target).emit('offer', {
        sdp: payload.sdp,
        caller: socket.id,
      });
    });

    // Handle WebRTC answer
    socket.on('answer', (payload) => {
      io.to(payload.target).emit('answer', {
        sdp: payload.sdp,
        caller: socket.id,
      });
    });

    // Handle WebRTC ICE candidates
    socket.on('ice-candidate', (payload) => {
      io.to(payload.target).emit('ice-candidate', {
        candidate: payload.candidate,
        from: socket.id,
      });
    });

    // NEW: Handle video state changes from a user
    socket.on('videoStateChange', ({ videoEnabled }) => {
      console.log(
        `User ${socket.id} in room ${roomId} changed video state to: ${videoEnabled}`
      );
      userVideoStates[roomId][socket.id] = videoEnabled; // Update the state on the server

      // Broadcast the video state change to all other users in the same room
      socket.to(roomId).emit('remoteVideoStateChange', {
        userId: socket.id,
        videoEnabled: videoEnabled,
      });
    });

    // Handle user disconnection from within the room context
    socket.on('disconnect', () => {
      if (rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        delete userVideoStates[roomId][socket.id]; // Remove user's video state

        socket.to(roomId).emit('user-disconnected', socket.id);

        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          delete userVideoStates[roomId]; // Clean up video states for empty room
          console.log(`Room ${roomId} has been deleted (empty)`);
        }
      }
    });
  });

  // Handle general disconnection (if user disconnects without explicitly leaving a room)
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId].includes(socket.id)) {
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        if (userVideoStates[roomId]) {
          // Check if room's video states exist
          delete userVideoStates[roomId][socket.id]; // Remove user's video state
        }
        socket.to(roomId).emit('user-disconnected', socket.id);

        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          delete userVideoStates[roomId]; // Clean up video states for empty room
          console.log(`Room ${roomId} has been deleted (empty)`);
        }
      }
    });
  });
});

server.listen(5000, () => console.log('Server running on port 5000'));
