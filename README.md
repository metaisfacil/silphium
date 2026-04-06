<p align="center">
	<img src="./frontend/public/silphium.svg" alt="Silphium logo" width="125" />
</p>

# Silphium

Silphium is a desktop music player built for people who already maintain a carefully curated local music library.

It is designed for listeners who are committed to the MetaBrainz ecosystem (MusicBrainz, ListenBrainz, and related tooling), and who already treat tagging as part of their normal library workflow.

## Who Silphium Is For

Silphium is a great fit if you:

- Maintain a local music library instead of relying only on streaming services.
- Keep your metadata clean and structured on purpose.
- Use MusicBrainz IDs and want your player to make good use of them.
- Want a player that understands albums, artists, releases, and technical track details in a consistently tagged collection.

## Important: Tagging Quality Matters

For the best results, tag your library with MusicBrainz Picard before using Silphium:

https://github.com/metabrainz/picard

Silphium performs best when your files include good metadata and MusicBrainz IDs. A well-tagged library improves:

- Track/album/artist labeling
- Metadata accuracy and consistency
- MusicBrainz-powered lookups and exploration
- Overall browsing and playback experience

## Highlights

- Local library scanning and browsing
- Playlist loading/saving
- Rich track metadata and technical info views
- ListenBrainz integration for scrobbling and feedback
- MusicBrainz-aware metadata workflows
- Audio output device selection and buffer tuning

## Development

Prerequisites:

- Go (project currently targets Go 1.25)
- Node.js and npm (for frontend build tooling)
- Wails CLI
- ffmpeg available on PATH

Run in development mode:

```bash
make dev
```

Run Go tests:

```bash
go test ./...
```

Run frontend tests:

```bash
cd frontend
npm test
```

Run frontend coverage:

```bash
cd frontend
npm run test:coverage
```

Build frontend only:

```bash
cd frontend
npm run build
```

Build desktop app:

```bash
make build
```

## Contributing

Contributions are welcome.

If you want to contribute:

1. Open an issue describing the problem or idea.
2. Fork the repository and create a feature branch.
3. Keep changes focused and include tests when practical.
4. Open a pull request with a clear explanation of what changed and why.

For user-facing changes, screenshots or short demo clips are helpful.

## License

Please refer to the repository license terms.

If a license file is not yet present in your local checkout, check the upstream repository page for the current licensing status before redistributing or reusing code.
