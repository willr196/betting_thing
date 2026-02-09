#!/bin/bash
# =============================================================================
# Prediction Platform — Quick Setup Script
# =============================================================================
# Run this from your project root: bash setup.sh
# =============================================================================

set -e

echo ""
echo "🎯 Prediction Platform — Quick Setup"
echo "======================================"
echo ""

# Check Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed."
    echo ""
    echo "Install it with:"
    echo "  sudo apt update && sudo apt install -y docker.io docker-compose-v2"
    echo "  sudo usermod -aG docker \$USER"
    echo "  # Then log out and back in"
    echo ""
    exit 1
fi

echo "✅ Docker found: $(docker --version)"

# Check docker compose
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose not found."
    echo "Install: sudo apt install -y docker-compose-plugin"
    exit 1
fi

echo "✅ Docker Compose found: $(docker compose version)"
echo ""

# Check for .env file
if [ ! -f .env ]; then
    if [ -f env.docker.example ]; then
        cp env.docker.example .env
        echo "📝 Created .env from env.docker.example"
    elif [ -f .env.example ]; then
        cp .env.example .env
        echo "📝 Created .env from .env.example"
    else
        echo "THE_ODDS_API_KEY=" > .env
        echo "📝 Created empty .env file"
    fi
    echo ""
    echo "⚠️  Edit .env and add your THE_ODDS_API_KEY before starting."
    echo "   Get a free key at: https://the-odds-api.com"
    echo ""
    read -p "Do you want to enter your Odds API key now? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Paste your API key: " api_key
        sed -i "s/THE_ODDS_API_KEY=.*/THE_ODDS_API_KEY=$api_key/" .env
        echo "✅ API key saved to .env"
    fi
else
    echo "✅ .env file exists"
fi

echo ""
echo "🔨 Building and starting services..."
echo "   (this may take a few minutes on first run)"
echo ""

# Build and start
docker compose up --build -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check health
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ API is running at http://localhost:3000"
else
    echo "⏳ API still starting up... check logs with: docker compose logs -f api"
fi

echo ""
echo "======================================"
echo "🎯 Setup Complete!"
echo "======================================"
echo ""
echo "  Frontend:  http://localhost:5173"
echo "  API:       http://localhost:3000/api/health"
echo ""
echo "  Test accounts:"
echo "    Admin: admin@example.com / Admin123!"
echo "    User:  test@example.com / Test123!"
echo ""
echo "  📱 Phone access:"
echo "    1. Install ngrok: curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok-v3-stable-linux-amd64.tgz | sudo tar xvz -C /usr/local/bin"
echo "    2. Auth: ngrok config add-authtoken YOUR_TOKEN"
echo "    3. Tunnel: ngrok http 5173"
echo "    4. Open the ngrok URL on your phone"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f     # View logs"
echo "    docker compose down        # Stop"
echo "    docker compose down -v     # Stop + wipe database"
echo ""
