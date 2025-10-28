# PDF Qutor 📝

An intelligent quiz generation web application that extracts multiple-choice questions from PDF documents and creates interactive quizzes with shuffled options.

## Features ✨

- 📄 **Multiple Format Support**: Upload PDF, DOCX, or TXT files
- 🤖 **AI-Powered Extraction**: Automatically extracts questions, options, and answers using GPT-4o-mini
- 🔀 **Smart Shuffling**: Randomizes answer options while tracking correct answers
- ✅ **Answer Verification**: AI verifies answers when not marked in the document
- 📊 **Interactive Quiz Interface**: Take quizzes with instant feedback
- 💾 **Download Results**: Export your quiz results as a text file
- 🎯 **Production Ready**: Handles 120+ questions in a single request

## Tech Stack 🛠️

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI**: OpenRouter API (GPT-4o-mini)
- **Document Processing**: pdf-parse, mammoth, formidable
- **Styling**: Tailwind CSS with custom gradients

## Getting Started 🚀

### Prerequisites

- Node.js 18+ installed
- OpenRouter API key ([Get one here](https://openrouter.ai/))

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pdf-qutor.git
cd pdf-qutor
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file in the root directory:
```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Deployment on Vercel 🌐

### Important Notes for Vercel

⚠️ **Serverless Function Timeout**: 
- **Hobby Plan (Free)**: 10-second timeout - NOT sufficient for large PDFs
- **Pro Plan ($20/month)**: Up to 300 seconds - Required for 100+ questions
- **This app is configured for Pro plan** (300-second timeout)

**Note**: To use this app with 120 questions, you MUST upgrade to Vercel Pro plan.

### Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/pdf-qutor)

### Manual Deployment

1. Push your code to GitHub

2. Go to [Vercel](https://vercel.com) and sign in

3. Click "New Project" and import your GitHub repository

4. Add environment variable:
   - `OPENROUTER_API_KEY`: Your OpenRouter API key

5. Click "Deploy"

## Usage 📖

1. **Upload Document**: Click "Upload PDF, DOCX, or TXT" and select your quiz file
2. **Wait for Extraction**: The AI will extract ALL questions (even 120+ questions!)
3. **Take Quiz**: Answer questions with shuffled options
4. **View Results**: See your score and download results

**Note**: Processing 120 questions takes about 30-60 seconds. For Vercel deployment, Pro plan is required.

## Environment Variables 🔐

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key for GPT-4o-mini | Yes |

## Project Structure 📁

```
pdf-qutor/
├── pages/
│   ├── api/
│   │   ├── extract.ts      # Document text extraction
│   │   └── summarize.ts    # Question extraction & processing
│   ├── quiz.tsx            # Interactive quiz interface
│   └── index.tsx           # Homepage redirect
├── styles/
│   └── globals.css         # Global styles
├── public/                 # Static assets
├── .env.local              # Environment variables (not in git)
├── next.config.js          # Next.js configuration
├── tailwind.config.js      # Tailwind CSS configuration
└── package.json            # Dependencies
```

## API Routes 🔌

### POST /api/extract
Extracts text from uploaded documents (PDF, DOCX, TXT)

**Request**: FormData with file
**Response**: `{ text: string }`

### POST /api/summarize
Extracts questions from text and processes them

**Request**: `{ text: string }`
**Response**: `{ questions: Question[] }`

## Features in Detail 🔍

### Question Extraction
- Extracts ALL questions from document (no limit)
- Identifies marked correct answers
- Cleans option text (removes A), B), etc.)
- Handles various answer formats (Answer:, Correct:, Ans:, *)

### Answer Verification
- AI verifies uncertain answers
- Falls back to knowledge base when answers missing
- Each question tagged with `verified` flag

### Option Shuffling
- Fisher-Yates algorithm ensures randomization
- Correct answer tracked through shuffle
- Same quiz, different order every time

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## License 📄

MIT License - feel free to use this project for your own purposes.

## Support 💬

If you encounter any issues or have questions, please open an issue on GitHub.

## Author ✍️

Created with ❤️ using Next.js and Open Router (API KEY)
Made by - Chirag Mishra
---

**Note**: This application uses AI to extract questions. Accuracy depends on document formatting and clarity. Always review extracted questions for accuracy.
