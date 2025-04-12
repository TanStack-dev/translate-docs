module.exports = {
  branches: [
    "main",
    {
      name: "f/*",
      channel: "next",
      prerelease:
        "beta-${(/^[a-zA-Z]+-[0-9]+/.exec(name.substr(2)) || [name.replace(/[_/.]/g, '-')])[0]}-${Date.now()}",
    },
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github",
    "@semantic-release/git",
    "@semantic-release/changelog",
  ],
};
