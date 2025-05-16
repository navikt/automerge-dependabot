# Makefile for automerge-dependabot GitHub Action

.PHONY: all test lint build clean help ci validate

# Default target
all: lint test build

# CI pipeline steps
ci: lint test build

# Validate code without building
validate: lint test

# Run tests
test:
	@echo "Running tests..."
	npm test

# Run linting
lint:
	@echo "Running linter..."
	npm run lint

# Build the project
build:
	@echo "Building project..."
	npm run build

# Clean build artifacts
clean:
	@echo "Cleaning up..."
	rm -rf dist
	rm -rf node_modules

# Install dependencies
install:
	@echo "Installing dependencies..."
	npm install

# Show help
help:
	@echo "Available targets:"
	@echo "  all         : Run lint, test and build (default)"
	@echo "  test        : Run tests"
	@echo "  lint        : Run linter"
	@echo "  build       : Build the project"
	@echo "  clean       : Remove build artifacts and dependencies"
	@echo "  install     : Install dependencies"
	@echo "  help        : Show this help message"
