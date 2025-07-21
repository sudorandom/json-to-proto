
# json-to-proto

Convert JSON objects to Protocol Buffers (protobuf) schema definitions with a simple web interface.

## Features

- Paste or upload a JSON object and generate a `.proto` schema.
- Supports nested objects and arrays.
- Type inference for numbers, strings, booleans, and repeated fields.
- Copy or download the generated protobuf schema.
- Built with React, TypeScript, Vite, and Tailwind CSS.

## Getting Started

### Prerequisites

- Node.js (v18 or newer recommended)

### Installation

```sh
git clone https://github.com/sudorandom/json-to-proto.git
cd json-to-proto
pnpm install # or npm install or yarn install
```

### Running Locally

```sh
pnpm dev # or npm run dev or yarn dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

## Usage

1. Paste your JSON object into the input area.
2. Click "Convert" to generate the protobuf schema.
3. Copy or download the `.proto` file for use in your project.

## Project Structure

- `src/` — React components and logic
- `public/` — Static assets
- `index.html` — Main HTML file
- `vite.config.ts` — Vite configuration
- `tailwind.config.js` — Tailwind CSS configuration

## Contributing

Pull requests and issues are welcome! Please open an issue to discuss major changes before submitting a PR.

## License

MIT
