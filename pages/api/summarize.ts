import { NextApiRequest, NextApiResponse } from 'next';

// Vercel serverless function configuration
export const config = {
  maxDuration: 300, // 5 minutes - requires Vercel Pro plan
};

interface Question {
  question: string;
  options: string[];
  correctAnswer: string;
  originalIndex?: number;
  verified: boolean;
}

interface QuizRequest {
  text: string;
}

interface QuizResponse {
  questions: Question[];
  error?: string;
}

// Shuffle array while keeping track of original positions
function shuffleOptions(options: string[], correctIndex: number): { shuffled: string[], newCorrectIndex: number } {
  const optionsWithIndex = options.map((opt, idx) => ({ option: opt, wasCorrect: idx === correctIndex }));
  
  // Fisher-Yates shuffle
  for (let i = optionsWithIndex.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionsWithIndex[i], optionsWithIndex[j]] = [optionsWithIndex[j], optionsWithIndex[i]];
  }
  
  const shuffled = optionsWithIndex.map(item => item.option);
  const newCorrectIndex = optionsWithIndex.findIndex(item => item.wasCorrect);
  
  return { shuffled, newCorrectIndex };
}

// Verify answer using AI if not confident
async function verifyAnswer(question: string, options: string[], proposedAnswer: string, apiKey: string): Promise<string> {
  try {
    const prompt = `Question: ${question}

Options:
${options.map((opt, idx) => `${String.fromCharCode(65 + idx)}) ${opt}`).join('\n')}

What is the correct answer? Respond with ONLY the exact option text, nothing else.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://pdf-qutor.vercel.app',
        'X-Title': 'PDF Qutor'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You respond with only the exact answer text, no explanations or additional text.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.1,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        const verifiedAnswer = data.choices[0].message.content.trim();
        
        // Find best match in options
        const match = options.find(opt => 
          opt.toLowerCase().includes(verifiedAnswer.toLowerCase()) ||
          verifiedAnswer.toLowerCase().includes(opt.toLowerCase())
        );
        
        return match || proposedAnswer;
      }
    }
  } catch (error) {
    console.error('Answer verification error:', error);
  }
  
  return proposedAnswer;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<QuizResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', questions: [] });
  }

  try {
    const { text } = req.body as QuizRequest;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided', questions: [] });
    }

    console.log(`Processing document with ${text.length} characters...`);

    // Use OpenRouter with GPT-4o-mini (can handle 120+ questions in one call)
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    
    if (!openRouterKey) {
      console.error('ERROR: OPENROUTER_API_KEY not found in environment variables');
      return res.status(500).json({ 
        error: 'API key not configured. Please add OPENROUTER_API_KEY to your Vercel environment variables.', 
        questions: [] 
      });
    }

    console.log('API Key found, length:', openRouterKey.length);

    try {
      const prompt = `You are a quiz extraction expert. Extract ALL multiple-choice questions from this document.

CRITICAL RULES:
1. Extract EVERY SINGLE question - do not skip any (even if there are 100+ questions)
2. For each question, extract the exact question text
3. Extract ALL options exactly as written
4. Find the correct answer marked in the document
5. Clean option text - remove prefixes like "A)", "1.", "a.", etc. - keep only content
6. For correctAnswer field:
   - If answer is a letter (A/B/C/D), put ONLY the letter (e.g., "A" not "Option A")
   - If answer is a number (1/2/3/4), put ONLY the number as string (e.g., "1")
   - If answer is the full option text, put the exact cleaned option text

IMPORTANT: Return ONLY valid JSON array with NO markdown, explanations, or extra text.

Format:
[
  {
    "question": "question text here",
    "options": ["option 1 content", "option 2 content", "option 3 content", "option 4 content"],
    "correctAnswer": "A",
    "answerMarkedInDocument": true
  }
]

Document:
${text}`; // Process entire document, no truncation

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://pdf-qutor.vercel.app',
          'X-Title': 'PDF Qutor'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a JSON-only response bot. You must respond with valid JSON only, no explanations, no markdown code blocks, no additional text.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 16000, // Increased to handle 120+ questions
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('OpenRouter API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        return res.status(response.status).json({ 
          error: `AI service error (${response.status}): ${errorData.error?.message || 'Please check your API key and try again'}`,
          questions: []
        });
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        return res.status(500).json({ 
          error: 'Invalid response from AI service',
          questions: []
        });
      }

      let responseText = data.choices[0].message.content;
      
      // More aggressive cleaning to extract JSON
      responseText = responseText.trim();
      
      // Remove markdown code blocks
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Try to find JSON array in the response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        responseText = jsonMatch[0];
      }
      
      const extractedQuestions = JSON.parse(responseText);
      
      if (!Array.isArray(extractedQuestions)) {
        return res.status(500).json({ 
          error: 'Invalid JSON structure received',
          questions: []
        });
      }
      
      console.log(`Total questions extracted: ${extractedQuestions.length}`);
      
      if (extractedQuestions.length > 0) {
        // Process and verify answers
        const processedQuestions = extractedQuestions.map((q: any, idx: number) => {
          // Clean and find correct answer
          let correctAnswer = q.correctAnswer;
          let verified = q.answerMarkedInDocument === true;
          
          // Try to match the correct answer to one of the options
          let correctIndex = q.options.findIndex((opt: string) => {
            const cleanOpt = opt.toLowerCase().trim().replace(/[^\w\s]/g, '');
            const cleanAnswer = correctAnswer.toLowerCase().trim().replace(/[^\w\s]/g, '');
            return cleanOpt === cleanAnswer || 
                   cleanOpt.includes(cleanAnswer) || 
                   cleanAnswer.includes(cleanOpt);
          });
          
          // If answer not found, try first letter matching (e.g., "B" -> second option)
          if (correctIndex === -1 && correctAnswer.length <= 2) {
            const answerLetter = correctAnswer.toUpperCase().trim();
            if (answerLetter >= 'A' && answerLetter <= 'Z') {
              const letterIndex = answerLetter.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
              if (letterIndex >= 0 && letterIndex < q.options.length) {
                correctIndex = letterIndex;
                correctAnswer = q.options[correctIndex];
                verified = true;
              }
            }
          }
          
          // If still not found, use first option as fallback
          if (correctIndex === -1) {
            console.log(`Warning: Could not find answer for question ${idx + 1}, using first option`);
            correctIndex = 0;
            correctAnswer = q.options[0];
            verified = false;
          }
          
          // Shuffle options
          const { shuffled, newCorrectIndex } = shuffleOptions(q.options, correctIndex);
          
          return {
            question: q.question,
            options: shuffled,
            correctAnswer: shuffled[newCorrectIndex],
            originalIndex: idx,
            verified
          };
        });
        
        return res.status(200).json({ questions: processedQuestions });
      }
      
      return res.status(400).json({ error: 'No questions found in the document', questions: [] });
    } catch (error) {
      console.error('OpenRouter error:', error);
      return res.status(500).json({ 
        error: 'Failed to extract questions. Please check your document format.',
        questions: []
      });
    }
  } catch (error) {
    console.error('Error extracting questions:', error);
    res.status(500).json({ 
      error: 'Failed to extract questions',
      questions: []
    });
  }
}
