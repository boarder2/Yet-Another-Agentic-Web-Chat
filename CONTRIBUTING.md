# How to Contribute to YAAWC

Thanks for your interest in contributing to YAAWC! Your help makes this project better. This guide explains how to contribute effectively.

YAAWC is a modern AI chat application with advanced search capabilities.

## Project Structure

YAAWC's codebase is organized as follows:

- **UI Components and Pages**:
  - **Components (`src/components`)**: Reusable UI components.
  - **Pages and Routes (`src/app`)**: Next.js app directory structure with page components.
    - Main app routes include: home (`/`), chat (`/c`), discover (`/discover`), library (`/library`), and settings (`/settings`).
  - **API Routes (`src/app/api`)**: API endpoints implemented with Next.js API routes.
    - `/api/chat`: Handles chat interactions.
    - Other endpoints for models, files, and suggestions.
- **Backend Logic (`src/lib`)**: Contains all the backend functionality including search, database, and API logic.
  - The search functionality is present inside `src/lib/search` directory.
  - Focus modes are handled by `SimplifiedAgent` in `src/lib/search/simplifiedAgent.ts`, which selects tools and prompts based on the mode.
  - Database functionality is in `src/lib/db`.
  - Chat model and embedding model providers are managed in `src/lib/providers`.
  - Prompt templates and LLM chain definitions are in `src/lib/prompts` and `src/lib/chains` respectively.

## API Documentation

YAAWC exposes API endpoints for programmatic access. The primary endpoint is `/api/chat` for streaming chat interactions. See the README for a full endpoint listing.

## Setting Up Your Environment

Before diving into coding, setting up your local environment is key. Here's what you need to do:

1. In the root directory, locate the `sample.config.toml` file.
2. Rename it to `config.toml` and fill in the necessary configuration fields.
3. Run `npm install` to install all dependencies.
4. Run `npm run db:push` to set up the local sqlite database.
5. Use `npm run dev` to start the application in development mode.

**Please note**: Docker configurations are present for setting up production environments, whereas `npm run dev` is used for development purposes.

## Coding and Contribution Practices

Before committing changes:

1. Ensure that your code functions correctly by thorough testing.
2. Always run `npm run format:write` to format your code according to the project's coding standards. This helps maintain consistency and code quality.
3. We currently do not have a code of conduct, but it is in the works. In the meantime, please be mindful of how you engage with the project and its community.

Following these steps will help maintain the integrity of YAAWC's codebase and facilitate a smoother integration of your valuable contributions. Thank you for your support and commitment to improving YAAWC.
