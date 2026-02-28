/**
 * Wordlists for anonymous username generation.
 * Themes: retrofuturistic, organic, cypherpunk, cloaked, ethereal.
 * Format: {adjective}{noun} e.g. "VoidCipher"
 * Max combined length: ~19 chars, fits in 31 bytes.
 */

export const adjectives = [
  // --- Original sci-fi / eco-explorer ---
  'Silent', 'Verdant', 'Stellar', 'Phantom', 'Crimson',
  'Lunar', 'Feral', 'Cobalt', 'Frosted', 'Amber',
  'Neon', 'Obsidian', 'Jade', 'Rustic', 'Spectral',
  'Vivid', 'Hollow', 'Radiant', 'Ashen', 'Primal',
  'Drift', 'Iron', 'Coral', 'Velvet', 'Solar',
  'Quantum', 'Arcane', 'Nimble', 'Stark', 'Woven',
  'Mossy', 'Glacial', 'Copper', 'Tidal', 'Flint',
  'Ember', 'Dusky', 'Gilded', 'Misty', 'Roving',
  'Keen', 'Pale', 'Wild', 'Deep', 'Swift',
  'Stray', 'Bright', 'Dusk', 'Peak', 'Storm',

  // --- Retrofuturistic ---
  'Analog', 'Chrome', 'Retro', 'Atomic', 'Vapor',
  'Synth', 'Noire', 'Plasma', 'Tesla', 'Static',
  'Optic', 'Flux', 'Mono', 'Turbo', 'Grid',
  'Pulse', 'Sonic', 'Arc', 'Wired', 'Pixel',

  // --- Organic / natural ---
  'Fungal', 'Lichen', 'Mycel', 'Fern', 'Rooted',
  'Bark', 'Spore', 'Thorn', 'Bloom', 'Loam',
  'Petal', 'Canopy', 'Moss', 'Briny', 'Ivy',
  'Cedar', 'Sage', 'Marsh', 'Briar', 'Vine',

  // --- Cypherpunk / encrypted ---
  'Void', 'Cipher', 'Zero', 'Masked', 'Hashed',
  'Forked', 'Rogue', 'Ghost', 'Null', 'Hex',
  'Burnt', 'Shadow', 'Covert', 'Veiled', 'Anon',
  'Dark', 'Signed', 'Sealed', 'Muted', 'Binary',

  // --- Cloaked / hidden ---
  'Shroud', 'Hidden', 'Unseen', 'Faded', 'Cloaked',
  'Secret', 'Latent', 'Coiled', 'Buried', 'Hushed',
  'Sunken', 'Blurred', 'Dim', 'Shaded', 'Lost',
  'Erased', 'Vanish', 'Folded', 'Traced', 'Muffled',

  // --- Ethereal / otherworldly ---
  'Astral', 'Lucid', 'Dreamt', 'Liminal', 'Halo',
  'Wraith', 'Prism', 'Aether', 'Clouded', 'Gentle',
  'Opal', 'Gossam', 'Twilit', 'Aurora', 'Phase',
  'Waning', 'Ether', 'Faint', 'Glim', 'Dew',
];

export const nouns = [
  // --- Original sci-fi / eco-explorer ---
  'Nebula', 'Grove', 'Cipher', 'Falcon', 'Thorn',
  'Reef', 'Specter', 'Ember', 'Dune', 'Glyph',
  'Lynx', 'Zenith', 'Moth', 'Spire', 'Raven',
  'Shard', 'Fern', 'Orbit', 'Wolf', 'Crest',
  'Flux', 'Petal', 'Nomad', 'Prism', 'Ridge',
  'Aura', 'Tusk', 'Wisp', 'Forge', 'Vault',
  'Drake', 'Pulse', 'Shroud', 'Cairn', 'Lichen',
  'Bloom', 'Sigil', 'Talon', 'Haze', 'Root',
  'Lark', 'Shade', 'Rune', 'Tide', 'Spark',
  'Echo', 'Mist', 'Pine', 'Star', 'Ash',

  // --- Retrofuturistic ---
  'Valve', 'Coil', 'Dynamo', 'Relay', 'Beacon',
  'Signal', 'Node', 'Lens', 'Diode', 'Core',
  'Vector', 'Matrix', 'Turbine', 'Dial', 'Module',
  'Conduit', 'Array', 'Scope', 'Alloy', 'Frame',

  // --- Organic / natural ---
  'Spore', 'Canopy', 'Burrow', 'Mycel', 'Stamen',
  'Tendril', 'Xylem', 'Rhizome', 'Frond', 'Hollow',
  'Thicket', 'Humus', 'Rill', 'Bract', 'Quill',
  'Pollen', 'Silk', 'Shell', 'Scale', 'Seed',

  // --- Cypherpunk / encrypted ---
  'Nonce', 'Hash', 'Block', 'Token', 'Proof',
  'Ledger', 'Daemon', 'Kernel', 'Socket', 'Port',
  'Thread', 'Sentry', 'Patch', 'Stack', 'Mutex',
  'Cypher', 'Proxy', 'Agent', 'Key', 'Mask',

  // --- Cloaked / hidden ---
  'Cloak', 'Veil', 'Shadow', 'Wraith', 'Fog',
  'Spectre', 'Trace', 'Riddle', 'Enigma', 'Mirage',
  'Mantle', 'Ghost', 'Viper', 'Dagger', 'Tunnel',
  'Crypt', 'Stash', 'Cache', 'Null', 'Haven',

  // --- Ethereal / otherworldly ---
  'Ether', 'Halo', 'Dusk', 'Dawn', 'Mote',
  'Wreath', 'Glimmer', 'Oasis', 'Drift', 'Chime',
  'Loom', 'Abyss', 'Nexus', 'Void', 'Wane',
  'Miasma', 'Corona', 'Umbra', 'Arc', 'Sylph',
];
