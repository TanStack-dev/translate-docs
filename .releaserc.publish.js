module.exports = {
  branches: ["main"],
  plugins: [
    "@semantic-release/npm",
    ["@semantic-release/github", {
      assets: []
    }]
  ]
} 