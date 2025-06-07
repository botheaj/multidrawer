const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const playerColorInput = document.getElementById('playerColor');
const colorPaletteDiv = document.getElementById('colorPalette');
const connectionStatusDiv = document.getElementById('connectionStatus');

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const BASE_PLAYER_SIZE = 20; // Base size, "medium"

const SIZES = {
    small: BASE_PLAYER_SIZE * 0.75,
    medium: BASE_PLAYER_SIZE,
    large: BASE_PLAYER_SIZE * 1.5,
};

const PREDEFINED_COLORS = {
    "red": "#FF0000",
    "orange": "#FFA500",
    "yellow": "#FFFF00",
    "green": "#008000", // Standard green
    "blue": "#0000FF",
    "purple": "#800080",
    "brown": "#A52A2A",
    "black": "#000000",
    "white": "#FFFFFF"
};

let currentShape = 'square';
let currentSizeName = 'medium';

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

let socket;
let myPlayerId = null;
let players = {}; // Local copy of all players: { id: { x, y, color } }
let localDrawnBlocks = []; // Local copy of all drawn blocks
let initialAppearanceSynced = false; 

function connectToServer() {
    const serverHostname = window.location.hostname; // Uses the hostname from the browser's address bar
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const serverPort = 8080; // Must match server's PORT

    socket = new WebSocket(`${protocol}//${serverHostname}:${serverPort}`);

    socket.onopen = () => {
        console.log('Connected to WebSocket server');
        connectionStatusDiv.textContent = 'Connected!';
        connectionStatusDiv.style.color = 'green';
        // Send initial color choice once connected and ID is (soon to be) assigned
        // The assignId handler will also ensure appearance is sent.
        if (myPlayerId) { // If ID already assigned (e.g. reconnect logic, though not fully implemented here)
             sendAppearanceUpdate();
        }
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'assignId') {
                myPlayerId = message.data.id;
                console.log('Assigned ID:', myPlayerId);
                initialAppearanceSynced = false; // Reset flag in case of re-assign (e.g. reconnect)
                // We will wait for the gameState to sync initial appearance
            } else if (message.type === 'gameState') {
                players = message.data.players;
                localDrawnBlocks = message.data.drawnBlocks || []; // Ensure it's an array

                if (myPlayerId && players[myPlayerId] && !initialAppearanceSynced) {
                    const myServerData = players[myPlayerId];
                    
                    // Sync color picker
                    playerColorInput.value = myServerData.color;

                    // Sync shape radio
                    const shapeRadio = document.querySelector(`input[name="playerShape"][value="${myServerData.shape}"]`);
                    if (shapeRadio) shapeRadio.checked = true;
                    
                    // Sync size radio
                    const sizeRadio = document.querySelector(`input[name="playerSize"][value="${myServerData.sizeName}"]`);
                    if (sizeRadio) sizeRadio.checked = true;
                    
                    // Update local state variables (primarily used by sendAppearanceUpdate if needed before UI interaction)
                    currentShape = myServerData.shape;
                    currentSizeName = myServerData.sizeName;

                    initialAppearanceSynced = true;
                    console.log('Initial appearance synced from server:', myServerData);
                }
                // No need to call draw() here, requestAnimationFrame handles it
            }
        } catch (error) {
            console.error('Error processing message from server:', error);
        }
    };

    socket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        connectionStatusDiv.textContent = 'Disconnected. Try refreshing.';
        connectionStatusDiv.style.color = 'red';
        myPlayerId = null;
        players = {}; // Clear players on disconnect
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        connectionStatusDiv.textContent = 'Connection Error. Is the server running?';
        connectionStatusDiv.style.color = 'red';
    };
}

// --- Handle Player Input ---
const keysPressed = {
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    w: false,
    s: false,
    a: false,
    d: false,
    ' ': false, // For spacebar
};

function draw() {
    // Handle movement input (send to server)
    if (socket && socket.readyState === WebSocket.OPEN && myPlayerId) {
        let dx = 0;
        let dy = 0;

        if (keysPressed.ArrowUp || keysPressed.w) dy -= 1;
        if (keysPressed.ArrowDown || keysPressed.s) dy += 1;
        if (keysPressed.ArrowLeft || keysPressed.a) dx -= 1;
        if (keysPressed.ArrowRight || keysPressed.d) dx += 1;
        
        socket.send(JSON.stringify({ type: 'input', data: { dx, dy } }));

        // Handle drawing input if spacebar is held
        if (keysPressed[' ']) {
            socket.send(JSON.stringify({ type: 'placeBlock' }));
        }
    }

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); // Clear canvas

    function drawShape(entity) {
        const x = entity.x;
        const y = entity.y;
        const size = entity.actualSize || SIZES[entity.sizeName] || BASE_PLAYER_SIZE; // Use actualSize from server, fallback for local
        const color = entity.color;

        ctx.fillStyle = color || '#CCCCCC';
        ctx.strokeStyle = 'black'; // Optional: border for all shapes
        ctx.lineWidth = 1;

        ctx.beginPath();
        switch (entity.shape) {
            case 'circle':
                ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
                break;
            case 'triangle':
                // Equilateral triangle pointing up, fitting within the 'size' bounding box
                const centerX = x + size / 2;
                const height = size * (Math.sqrt(3)/2); // Height of an equilateral triangle
                // Adjust y for visual centering if desired, or keep top-aligned
                // For simplicity, let's make it point up from the base of the bounding box.
                // Or, a simpler isosceles triangle:
                ctx.moveTo(centerX, y); // Top point
                ctx.lineTo(x, y + size); // Bottom-left
                ctx.lineTo(x + size, y + size); // Bottom-right
                ctx.closePath();
                break;
            case 'square':
            default:
                ctx.rect(x, y, size, size);
                break;
        }
        ctx.fill();
        // if (entity.shape !== 'square') ctx.stroke(); // Optional: stroke for non-squares
    }

    // Draw all placed blocks first (so players are drawn on top)
    localDrawnBlocks.forEach(block => {
        // Server now sends actualSize for blocks, but we can fallback if needed
        const blockToDraw = { ...block, actualSize: block.actualSize || SIZES[block.sizeName] || BASE_PLAYER_SIZE };
        drawShape(blockToDraw);
    });

    // Draw all players
    for (const id in players) {
        const player = players[id];
        // Server sends actualSize for players
        const playerToDraw = { ...player, actualSize: player.actualSize || SIZES[player.sizeName] || BASE_PLAYER_SIZE };
        drawShape(playerToDraw);

        // Highlight the local player
        if (id === myPlayerId) {
            const size = playerToDraw.actualSize;
            ctx.strokeStyle = 'gold'; // A distinct color for the border
            ctx.lineWidth = 3;
            // Adjust highlight based on shape if needed, for now a simple bounding box
            ctx.strokeRect(player.x -1, player.y -1, size + 2, size + 2);
        }
    }
    requestAnimationFrame(draw); // Continuous rendering loop
}

window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase(); // Normalize to lowercase for 'w', 'a', 's', 'd'
    const originalKey = e.key; // For keys like ' ' (space) or 'ArrowUp'

    if (keysPressed.hasOwnProperty(key) || keysPressed.hasOwnProperty(originalKey)) {
        e.preventDefault(); // Prevent page scrolling with arrow keys

        if (keysPressed.hasOwnProperty(key) && !keysPressed[key]) keysPressed[key] = true;
        if (keysPressed.hasOwnProperty(originalKey) && !keysPressed[originalKey]) keysPressed[originalKey] = true;
        // Movement and drawing (spacebar) sending is now handled by the draw() loop
    }
});

window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase(); // Normalize to lowercase
    const originalKey = e.key;
    if (keysPressed.hasOwnProperty(key) || keysPressed.hasOwnProperty(originalKey)) {
        e.preventDefault();
        if (keysPressed.hasOwnProperty(key)) keysPressed[key] = false;
        if (keysPressed.hasOwnProperty(originalKey)) keysPressed[originalKey] = false;
    }
});


// Handle color change
playerColorInput.addEventListener('input', () => sendAppearanceUpdate());

// Handle palette clicks
colorPaletteDiv.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-swatch')) {
        const colorName = e.target.dataset.color; // e.g., "red", "blue"
        const hexColor = PREDEFINED_COLORS[colorName];
        if (hexColor) {
            playerColorInput.value = hexColor; // Set the color picker to the hex value
        }
        sendAppearanceUpdate();
    }
});

// Handle shape and size changes
document.querySelectorAll('input[name="playerShape"]').forEach(radio => {
    radio.addEventListener('change', sendAppearanceUpdate);
});
document.querySelectorAll('input[name="playerSize"]').forEach(radio => {
    radio.addEventListener('change', sendAppearanceUpdate);
});


function sendAppearanceUpdate() {
    const shape = document.querySelector('input[name="playerShape"]:checked').value;
    const sizeName = document.querySelector('input[name="playerSize"]:checked').value;
    const color = playerColorInput.value;

    currentShape = shape; // Update local state for immediate feedback if needed (though server is authoritative)
    currentSizeName = sizeName;

    if (socket && socket.readyState === WebSocket.OPEN && myPlayerId) {
        socket.send(JSON.stringify({ type: 'setAppearance', data: { shape, sizeName, color } }));
    }
}

// --- Initialize ---
connectToServer(); // Attempt to connect to the server
draw(); // Start the rendering loop
