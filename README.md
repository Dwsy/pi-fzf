# pi-fzf

Fuzzy file autocomplete for [pi](https://github.com/mariozechner/pi) powered by fzf.

## Features

### `@` File Autocomplete

Type `@` followed by a fuzzy query to get ranked file suggestions directly in the editor:

```
@readme
@src/index
@"folder with spaces/file"
```

- Uses `fd` to list project files (respects `.gitignore`)
- Uses `fzf --filter` for fast fuzzy matching
- Supports quoted paths for spaces

### `$` Command Autocomplete

Type `$` to search and insert commands, prompts, and skills:

```
$brainstorming
$writing
$skill:tmux
```

- Searches command names and descriptions
- Supports fuzzy matching

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

1. **File Indexing**: `fd` lists all files in your project (respects `.gitignore`)
2. **Fuzzy Search**: `fzf --filter` provides fast fuzzy matching
3. **Smart Autocomplete**: Integrates with pi's editor to surface ranked results

## License

MIT
