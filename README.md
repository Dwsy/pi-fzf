# pi-fzf

Fuzzy file autocomplete for [pi](https://github.com/mariozechner/pi) powered by fzf.

## Features

Type `@` followed by a fuzzy query to get ranked file suggestions directly in the editor:

```
@readme
@src/index
@"folder with spaces/file"
```

## Requirements

| Tool | Description | Install |
|------|-------------|---------|
| **fzf** | Fuzzy matching engine | `brew install fzf` |
| **fd** | Fast file listing | `brew install fd` |

## Installation

```bash
pi install github:Dwsy/pi-fzf
```

## How It Works

1. **File Indexing**: Uses `fd` to list all files in your project (respects `.gitignore`)
2. **Fuzzy Search**: Uses `fzf --filter` for fast fuzzy matching
3. **Autocomplete**: Integrates with pi's editor to provide ranked suggestions

## License

MIT
