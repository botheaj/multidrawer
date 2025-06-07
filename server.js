const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const BASE_PLAYER_SIZE = 20; // Represents "medium" size
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SERVER_TICK_RATE = 60; // Game updates per second
const PLAYER_SPEED = 150; // Pixels per second
// const PUSH_FACTOR = 0.6; // No longer used as collision was removed

const SIZES = {
    small: BASE_PLAYER_SIZE * 0.75,
    medium: BASE_PLAYER_SIZE,
    large: BASE_PLAYER_SIZE * 1.5,
};

let players = {}; // Stores state of all players: { id: { x, y, color, shape, sizeName, actualSize, id, lastInput: {dx, dy} } }
let drawnBlocks = []; // Stores all blocks placed by players: [{ x, y, color, shape, sizeName, actualSize }]

// --- HTTP Server to serve client files ---
const server = http.createServer((req, res) => {
    let servePath;
    let contentType;

    if (req.url === '/' || req.url === '/index.html') {
        servePath = path.join(__dirname, 'public', 'index.html');
        contentType = 'text/html';
    } else if (req.url === '/client.js') {
        servePath = path.join(__dirname, 'public', 'client.js');
        contentType = 'text/javascript';
    } else {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }

    fs.readFile(servePath, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end('Error loading file.');
            console.error(`Error reading ${servePath}:`, err);
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// --- WebSocket Server Logic ---
const wss = new WebSocket.Server({ server });

function broadcastGameState() {
    const gameState = { type: 'gameState', data: { players, drawnBlocks } };
    const gameStateString = JSON.stringify(gameState);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(gameStateString);
        }
    });
}

// --- Game Loop ---
function gameTick() {
    const deltaTime = 1 / SERVER_TICK_RATE; // Time elapsed per tick in seconds

    for (const playerId in players) {
        const movingPlayer = players[playerId];
        if (!movingPlayer.lastInput) continue; // Should not happen if initialized correctly

        const { dx, dy } = movingPlayer.lastInput;

        if (dx === 0 && dy === 0) {
            continue; // No movement input for this player
        }

        const moveAmount = PLAYER_SPEED * deltaTime;

        let intendedX = movingPlayer.x + dx * moveAmount;
        let intendedY = movingPlayer.y + dy * moveAmount;

        // Boundary checks for canvas
        let boundedIntendedX = Math.max(0, Math.min(CANVAS_WIDTH - movingPlayer.actualSize, intendedX));
        let boundedIntendedY = Math.max(0, Math.min(CANVAS_HEIGHT - movingPlayer.actualSize, intendedY));

        // No collision, simply move to the (boundary-checked) intended position
        movingPlayer.x = boundedIntendedX;
        movingPlayer.y = boundedIntendedY;
    }
    broadcastGameState(); // Send the updated state to all clients after all players are processed
}

wss.on('connection', (ws) => {
    const playerId = uuidv4();
    console.log(`Player ${playerId} connected.`);

    // Initialize player
    players[playerId] = {
        id: playerId,
        x: Math.floor(Math.random() * (CANVAS_WIDTH - SIZES['medium'])), // Use default medium size for initial placement
        y: Math.floor(Math.random() * (CANVAS_HEIGHT - SIZES['medium'])), // Use default medium size for initial placement
        color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`, // Random initial color
        shape: 'square', // Default shape
        sizeName: 'medium', // Default size name
        actualSize: SIZES['medium'], // Default actual size
        lastInput: { dx: 0, dy: 0 }, // Initialize lastInput
    };

    // Send the new player their ID
    ws.send(JSON.stringify({ type: 'assignId', data: { id: playerId } }));

    // Broadcast the updated game state to all players
    broadcastGameState();

    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            const movingPlayer = players[playerId]; // playerId is the ID of the client that sent the message
            if (!movingPlayer) return; // Player might have disconnected

            if (parsedMessage.type === 'input') {
                const { dx, dy } = parsedMessage.data;
                movingPlayer.lastInput = { dx, dy };
                // Movement is now handled by gameTick, no immediate broadcast or position update here.
            } else if (parsedMessage.type === 'placeBlock') {
                if (movingPlayer) {
                    drawnBlocks.push({
                        x: movingPlayer.x,
                        y: movingPlayer.y,
                        color: movingPlayer.color,
                        shape: movingPlayer.shape,
                        sizeName: movingPlayer.sizeName,
                        actualSize: movingPlayer.actualSize
                    });
                    broadcastGameState(); // Immediately inform clients about the new block
                }
            } else if (parsedMessage.type === 'setAppearance') {
                const { shape, sizeName, color } = parsedMessage.data;
                if (movingPlayer) {
                    movingPlayer.shape = shape || movingPlayer.shape;
                    movingPlayer.sizeName = sizeName || movingPlayer.sizeName;
                    movingPlayer.color = color || movingPlayer.color;
                    movingPlayer.actualSize = SIZES[movingPlayer.sizeName] || BASE_PLAYER_SIZE;
                }
                broadcastGameState(); 
            }
        } catch (error) {
            console.error(`Failed to parse message or handle event for player ${playerId}:`, error);
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        delete players[playerId];
        broadcastGameState(); // Notify other players
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
        // Ensure player is cleaned up if an error causes a disconnect
        if (players[playerId]) {
            delete players[playerId];
            broadcastGameState();
        }
    });
});

server.listen(PORT, '0.0.0.0', () => { // Listen on all available network interfaces
    console.log(`Server running. Open http://localhost:${PORT} in your browser.`);
    console.log(`Other players on LAN can connect to http://<your-local-ip>:${PORT}`);
    console.log(`WebSocket server started on port ${PORT}`);

    // Start the game loop
    setInterval(gameTick, 1000 / SERVER_TICK_RATE);
});
