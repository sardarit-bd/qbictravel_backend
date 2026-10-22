# QbicTravel Backend

A TypeScript backend built with Node.js, Express.js, PostgreSQL, and Prisma ORM. This project provides the backend foundation for a travel management platform covering travel services, customer bookings, agent operations, pricing, payments, and fulfillment.

## Tech Stack

- **Runtime:** Node.js 22+
- **Framework:** Express.js
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Authentication:** JSON Web Token (JWT), bcryptjs
- **Validation:** Yup
- **Security:** Helmet, CORS, express-rate-limit, express-xss-sanitizer
- **Logging:** Pino
- **API Documentation:** Swagger
- **Additional Services:** Supabase
- **Development:** tsx, nodemon
- **Containerization:** Docker

## Core Features

The planned platform scope includes:

- **Authentication and Access Control:** Customer authentication, administrator-managed agent accounts, and role-based permissions.
- **Travel Services:** Hotels, travel packages, tours, pricing, and availability information.
- **Booking Management:** Direct customer bookings, agent-created bookings, and booking history.
- **Agent Operations:** Customer management, booking updates, negotiated pricing, and commission tracking.
- **Pricing Management:** Standard prices, discounts, and administrator-defined pricing limits.
- **Payment Management:** Payment records, multiple payment methods, and payment verification.
- **Travel Fulfillment:** Operational booking management and fulfillment tracking.
- **Notifications:** Email updates for relevant booking and payment events.
- **Reports and Analytics:** Administrative reporting and restricted agent-specific reports.

> **Project scope:** These features describe the intended platform capabilities. Availability integrations, booking confirmation rules, payment verification permissions, and commission calculations require implementation or final business approval as applicable.

## Prerequisites

Install the following before getting started:

- Node.js 22 or later
- npm
- PostgreSQL or a compatible configured Supabase database
- Git
- Docker (optional)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/sardarit-bd/qbictravel_backend.git
cd qbictravel_backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a local environment file:

```bash
cp .env.example .env
```

Configure `DATABASE_URL` and the other environment variables required by the application.

**Security:** Never commit `.env`, database credentials, JWT secrets, or other sensitive configuration to version control.

### 4. Set Up Prisma

Generate the Prisma client:

```bash
npx prisma generate
```

Apply development migrations when using the project's migration workflow:

```bash
npx prisma migrate dev
```

Ensure the database exists and the connection string is correct before running migrations.

### 5. Start the Development Server

```bash
npm run dev
```

### 6. Build and Run for Production

Build the application:

```bash
npm run build
```

Start the production application:

```bash
npm start
```

Ensure these commands match the scripts configured in `package.json`.

## Docker Development

The following commands use the project's development Dockerfile and support source-code mounting for development.

### Build the Image

```bash
docker build -f Dockerfile.dev -t express-api-dev .
```

### Run the Container

```bash
docker run -d \
  --name express-api-dev \
  -p 5000:5000 \
  --add-host=host.docker.internal:host-gateway \
  --env-file .env \
  -v "$PWD:/app" \
  -v /app/node_modules \
  express-api-dev
```

When PostgreSQL runs on the host machine, use `host.docker.internal` in the container's database connection string. If PostgreSQL runs in another container, configure the appropriate Docker network and database hostname.

### View Logs

```bash
docker logs -f --tail 100 express-api-dev
```

### Stop the Container

```bash
docker stop express-api-dev
```

## API Documentation

**Development base URL**

```text
http://localhost:5000
```

**API prefix**

```text
/api
```

API endpoints are mounted under `/api` where configured in the application.

Test endpoints using Postman, `curl`, or Swagger UI when configured. Refer to the application's route definitions for available endpoints, HTTP methods, request bodies, validation requirements, and authentication rules.

The root endpoint (`GET /`) currently returns plain text. Individual API endpoints may use the application's standard JSON response format, depending on their implementation.

## Testing

Use the project's configured test scripts to verify changes. Where applicable, test:

- Request validation and error handling
- Authentication and authorization
- Database operations and migrations
- API response behavior
- Relevant unit and integration tests

Check `package.json` for the available test commands.

## Development Principles

- Follow the existing modular, layered architecture.
- Keep business logic in services and database queries in repositories where the module follows that pattern.
- Validate incoming requests using the existing Yup schemas.
- Reuse shared middleware, error handlers, logging, and response utilities.
- Enforce role-based permissions and restrict access to authorized customer and booking data.
- Verify service availability and pricing before confirming eligible bookings.
- Keep booking, payment, and fulfillment statuses separate.
- Make focused changes and run relevant tests before committing.
- Never expose secrets or sensitive customer information in logs.

## Project Status

This repository serves as the backend foundation for the QbicTravel travel management platform. Features and integrations should be implemented according to the approved requirements and the existing codebase architecture.
