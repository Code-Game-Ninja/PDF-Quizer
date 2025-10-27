import { NextApiRequest, NextApiResponse } from 'next';

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
      return res.status(500).json({ 
        error: 'No API key configured', 
        questions: [] 
      });
    }

    try {
      const prompt = `You are a quiz extraction expert. Extract ALL multiple-choice questions from this document.

CRITICAL RULES:
1. Extract EVERY SINGLE question - do not skip any (even if there are 100+ questions)
2. For each question, extract the exact question text
3. Extract ALL options exactly as written (A, B, C, D or 1, 2, 3, 4)
4. Find the correct answer that is marked in the document (look for "Answer:", "Correct:", "Ans:", asterisk *, or any marking)
5. Clean up the option text - remove letters/numbers like "A)", "1.", etc. - keep only the actual option content
6. If answer is marked as a letter (e.g., "Answer: B"), match it to the corresponding option

IMPORTANT: Return ONLY a valid JSON array with NO additional text, explanations, or markdown formatting.

Expected format:
[
  {
    "question": "exact question text",
    "options": ["clean option 1", "clean option 2", "clean option 3", "clean option 4"],
    "correctAnswer": "exact matching option text",
    "answerMarkedInDocument": true
  }
]

Document:
${text}`;

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
        console.error('OpenRouter API error:', errorData);
        return res.status(response.status).json({ 
          error: `Failed to extract questions. Please try again.`,
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
        const processedQuestions = await Promise.all(
          extractedQuestions.map(async (q: any, idx: number) => {
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
            
            // If answer not found or not marked in document, verify with AI
            if (correctIndex === -1 || !verified) {
              console.log(`Verifying answer for question ${idx + 1}...`);
              correctAnswer = await verifyAnswer(q.question, q.options, correctAnswer, openRouterKey);
              correctIndex = q.options.findIndex((opt: string) => 
                opt.toLowerCase().trim().replace(/[^\w\s]/g, '') === correctAnswer.toLowerCase().trim().replace(/[^\w\s]/g, '')
              );
              verified = true;
            }
            
            // If still not found, use first option as fallback
            if (correctIndex === -1) {
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
          })
        );
        
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
