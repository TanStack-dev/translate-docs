module.exports = {
  branches: [
    "main",
    {
      name: "f/*",
      channel: "next",
      prerelease:
        "beta-${(/^[a-zA-Z]+-[0-9]+/.exec(name.substr(2)) || [name.replace(/[_/.]/g, '-')])[0]}-${Date.now()}",
    },
  ]
};
