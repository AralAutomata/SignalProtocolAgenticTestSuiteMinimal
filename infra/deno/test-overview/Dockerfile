FROM denoland/deno:2.6.7

# Set working directory
WORKDIR /app

# Copy source
COPY main.ts .

# Port
EXPOSE 8000

# Run with necessary permissions
CMD ["deno", "run", "--allow-net", "--allow-env", "main.ts"]
