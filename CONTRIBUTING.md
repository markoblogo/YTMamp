# Contributing to YTMamp

First off, thank you for considering contributing to YTMamp!

## Development Setup

1. **Clone the repo**:
   ```bash
   git clone https://github.com/your-username/YTMamp.git
   cd YTMamp
   ```

2. **Setup the App**:
   ```bash
   cd app
   npm install
   npm start
   ```

3. **Setup the Extension**:
   - Open Chrome/Brave/Edge and navigate to `chrome://extensions`.
   - Enable **Developer mode**.
   - Click **Load unpacked** and select the `extension/` directory.

## Rules
- **No DRM Bypassing**: Do not submit features that attempt to bypass YouTube's DRM or skip ads in a way that violates their Terms of Service.
- **Styling**: Keep the "Modern Retro" aesthetic (Black/Neon Green).
- **Security**: All communication must remain on `localhost`.

## Testing
Please test your changes both in the development environment (`npm start`) and as a production build (`npm run dist`) before submitting a PR.
