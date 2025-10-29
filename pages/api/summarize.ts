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

// Process large documents by splitting into chunks
async function processLargeDocument(
  text: string, 
  apiKey: string, 
  res: NextApiResponse<QuizResponse>
): Promise<void> {
  console.log('Processing large document in chunks...');
  
  // Split text into chunks (approximately 30 questions per chunk)
  const chunkSize = 15000; // Characters per chunk
  const chunks: string[] = [];
  
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  
  console.log(`Split into ${chunks.length} chunks`);
  
  const allQuestions: any[] = [];
  
  // Process each chunk sequentially
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
    
    const prompt = `You are a quiz extraction expert. Extract ALL multiple-choice questions from this text chunk.

CRITICAL INSTRUCTIONS FOR ANSWER EXTRACTION:
1. Look for explicit answer indicators in the document:
   - "Answer:", "Ans:", "Correct Answer:", "ANS:", "Correct:", "Right Answer:"
   - Answers marked with asterisk (*), checkmark (✓), or highlighted
   - "Correct option is", "The answer is"
2. If answer is given as a letter (A/B/C/D), extract that EXACT letter
3. If answer is given as option text, extract that EXACT text
4. If answer is given as a number (1/2/3/4), convert to letter (1=A, 2=B, 3=C, 4=D)
5. Pay attention to the answer format in the document - preserve it exactly

QUESTION EXTRACTION RULES:
1. Extract EVERY SINGLE QUESTION from this chunk
2. Extract the exact question text (remove question numbers if present)
3. Extract ALL options exactly as written (usually 4 options)
4. Clean option text - remove ONLY prefixes like "A)", "B)", "1.", "2.", "a)", "b)", "•", "-"
   - Keep the actual content intact
5. DO NOT modify the option content itself

ANSWER FORMAT IN RESPONSE:
- If the document shows "Answer: B" → use "B"
- If the document shows "Answer: The sun is hot" → use "The sun is hot"
- If the document shows "Correct Answer: 2" → use "B" (convert 2 to B)
- If the document shows "Ans: (c)" → use "C"
- Mark answerMarkedInDocument as true ONLY if you found an explicit answer marking

RESPONSE FORMAT:
Return ONLY a valid JSON array with NO markdown, NO explanations, NO code blocks.

[
  {
    "question": "question text here",
    "options": ["option 1 content", "option 2 content", "option 3 content", "option 4 content"],
    "correctAnswer": "B",
    "answerMarkedInDocument": true,
    "answerNote": "Found as 'Answer: B' in document"
  }
]

Text chunk ${i + 1}:
${chunks[i]}`;

    try {
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
              content: 'You are a JSON-only response bot. CRITICAL: Extract the EXACT answer as marked in the document. If answer says "B", return "B". If answer says "2", convert to "B". Look carefully for answer indicators like "Answer:", "Ans:", "Correct Answer:". Return valid JSON array only, no markdown blocks, no explanations.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 16000,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        console.error(`Chunk ${i + 1} failed:`, response.status);
        continue; // Skip this chunk and continue
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error(`Invalid response for chunk ${i + 1}`);
        continue;
      }

      let responseText = data.choices[0].message.content.trim();
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        responseText = jsonMatch[0];
      }
      
      const extractedQuestions = JSON.parse(responseText);
      
      if (Array.isArray(extractedQuestions)) {
        allQuestions.push(...extractedQuestions);
        console.log(`Chunk ${i + 1}: Extracted ${extractedQuestions.length} questions (Total: ${allQuestions.length})`);
        // Log first question's answer for debugging
        if (extractedQuestions.length > 0) {
          console.log(`Sample from chunk ${i + 1}: Q1 Answer="${extractedQuestions[0].correctAnswer}", Marked=${extractedQuestions[0].answerMarkedInDocument}`);
        }
      }
    } catch (error) {
      console.error(`Error processing chunk ${i + 1}:`, error);
      // Continue with next chunk
    }
  }
  
  console.log(`Total questions extracted from all chunks: ${allQuestions.length}`);
  
  if (allQuestions.length === 0) {
    res.status(400).json({ error: 'No questions found in the document', questions: [] });
    return;
  }
  
  // Process and shuffle all questions
  const processedQuestions = allQuestions.map((q: any, idx: number) => {
    let correctAnswer = q.correctAnswer;
    let verified = q.answerMarkedInDocument === true;
    
    // Log original answer for debugging
    if (idx < 3) {
      console.log(`Q${idx + 1}: Original answer="${correctAnswer}", Options=[${q.options.join(', ')}]`);
    }
    
    let correctIndex = q.options.findIndex((opt: string) => {
      const cleanOpt = opt.toLowerCase().trim().replace(/[^\w\s]/g, '');
      const cleanAnswer = correctAnswer.toLowerCase().trim().replace(/[^\w\s]/g, '');
      return cleanOpt === cleanAnswer || 
             cleanOpt.includes(cleanAnswer) || 
             cleanAnswer.includes(cleanOpt);
    });
    
    if (correctIndex === -1 && correctAnswer.length <= 2) {
      const answerLetter = correctAnswer.toUpperCase().trim();
      if (answerLetter >= 'A' && answerLetter <= 'Z') {
        const letterIndex = answerLetter.charCodeAt(0) - 65;
        if (letterIndex >= 0 && letterIndex < q.options.length) {
          correctIndex = letterIndex;
          correctAnswer = q.options[correctIndex];
          verified = true;
        }
      }
    }
    
    if (correctIndex === -1) {
      console.log(`Warning: Could not find answer for question ${idx + 1}, using first option`);
      correctIndex = 0;
      correctAnswer = q.options[0];
      verified = false;
    }
    
    const { shuffled, newCorrectIndex } = shuffleOptions(q.options, correctIndex);
    
    return {
      question: q.question,
      options: shuffled,
      correctAnswer: shuffled[newCorrectIndex],
      originalIndex: idx,
      verified
    };
  });
  
  res.status(200).json({ questions: processedQuestions });
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

    // Check if we need to chunk the document for large PDFs
    const estimatedQuestions = Math.floor(text.length / 400); // Rough estimate: 400 chars per question
    console.log(`Estimated questions in document: ${estimatedQuestions}`);
    
    // If document is very large, process in chunks
    if (text.length > 50000 || estimatedQuestions > 30) {
      console.log('Large document detected, using chunking strategy...');
      return await processLargeDocument(text, openRouterKey, res);
    }

    try {
      const prompt = `You are a quiz extraction expert. Extract ALL multiple-choice questions from this document.

CRITICAL INSTRUCTIONS FOR ANSWER EXTRACTION:
1. Look for explicit answer indicators in the document:
   - "Answer:", "Ans:", "Correct Answer:", "ANS:", "Correct:", "Right Answer:"
   - Answers marked with asterisk (*), checkmark (✓), or highlighted
   - "Correct option is", "The answer is"
2. If answer is given as a letter (A/B/C/D), extract that EXACT letter
3. If answer is given as option text, extract that EXACT text  
4. If answer is given as a number (1/2/3/4), convert to letter (1=A, 2=B, 3=C, 4=D)
5. Pay attention to the answer format in the document - preserve it exactly

QUESTION EXTRACTION RULES:
1. Extract EVERY SINGLE QUESTION - do not stop at 10 or 15 questions
2. Extract the exact question text (remove question numbers if present)
3. Extract ALL options exactly as written (usually 4 options)
4. Clean option text - remove ONLY prefixes like "A)", "B)", "1.", "2.", "a)", "b)", "•", "-"
   - Keep the actual content intact
5. DO NOT modify the option content itself

ANSWER FORMAT IN RESPONSE:
- If the document shows "Answer: B" → use "B"
- If the document shows "Answer: The sun is hot" → use "The sun is hot"
- If the document shows "Correct Answer: 2" → use "B" (convert 2 to B)
- If the document shows "Ans: (c)" → use "C"
- Mark answerMarkedInDocument as true ONLY if you found an explicit answer marking

RESPONSE FORMAT:
Return ONLY a valid JSON array with NO markdown, NO explanations, NO code blocks.

[
  {
    "question": "question text here",
    "options": ["option 1 content", "option 2 content", "option 3 content", "option 4 content"],
    "correctAnswer": "B",
    "answerMarkedInDocument": true,
    "answerNote": "Found as 'Answer: B' in document"
  },
  ... (continue for ALL questions in document)
]

Document text:
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
              content: 'You are a JSON-only response bot. CRITICAL: Extract the EXACT answer as marked in the document. If answer says "B", return "B". If answer says "2", convert to "B". Look carefully for answer indicators like "Answer:", "Ans:", "Correct Answer:". Return valid JSON array only, no markdown blocks, no explanations.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 32000, // Maximum for gpt-4o-mini to handle 120+ questions
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
          if (idx < 3) console.log(`Q${idx + 1}: Matched by letter "${answerLetter}" -> index ${correctIndex}`);
        }
      }
      // Try number matching (1=A, 2=B, 3=C, 4=D)
      else if (answerLetter >= '1' && answerLetter <= '4') {
        const numberIndex = parseInt(answerLetter) - 1; // 1=0, 2=1, 3=2, 4=3
        if (numberIndex >= 0 && numberIndex < q.options.length) {
          correctIndex = numberIndex;
          correctAnswer = q.options[correctIndex];
          verified = true;
          if (idx < 3) console.log(`Q${idx + 1}: Matched by number "${answerLetter}" -> index ${correctIndex}`);
        }
      }
    }          // If still not found, use first option as fallback
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
