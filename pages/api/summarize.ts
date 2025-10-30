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
  
  // Split text into chunks (approximately 40-50 questions per chunk)
  const chunkSize = 25000; // Increased to 25k characters per chunk
  const chunks: string[] = [];
  
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  
  console.log(`Split into ${chunks.length} chunks`);
  
  const allQuestions: any[] = [];
  
  // Process each chunk sequentially
  for (let i = 0; i < chunks.length; i++) {
    console.log(`\n=== Processing chunk ${i + 1}/${chunks.length} ===`);
    console.log(`Chunk ${i + 1} size: ${chunks[i].length} characters`);
    
    const prompt = `You are a quiz extraction expert. Extract ALL multiple-choice questions from this text chunk.

CRITICAL INSTRUCTIONS FOR ANSWER EXTRACTION - READ CAREFULLY:
1. Look for explicit answer indicators AFTER the options:
   - "Answer:", "Ans:", "Ans.=", "Ans =", "Correct Answer:", "ANS:", "Correct:", "Right Answer:", "Solution:"
   - Look for "Ans.= a", "Ans = b", "Answer: c", etc.
   - Answers in parentheses like "(Answer: B)" or "(Ans: d)"
   - Answer section at the end of questions
2. EXTRACT THE EXACT ANSWER VALUE:
   - If you see "Ans.= b" → extract "b" (lowercase)
   - If you see "Answer: B" → extract "B" (uppercase)
   - If you see "Ans: blood" → extract "blood"
   - If you see "Correct Answer: 2" → extract "2"
3. DO NOT GUESS - only extract if explicitly stated
4. Pay attention to letter case - preserve it exactly

QUESTION EXTRACTION RULES:
1. Extract EVERY SINGLE QUESTION from this chunk
2. Extract the exact question text (remove question numbers like "1)", "2)", "Q1:", etc.)
3. Extract ALL options exactly as written (usually 4 options: a, b, c, d OR A, B, C, D OR 1, 2, 3, 4)
4. Clean option text - remove ONLY prefixes like "a)", "A)", "1.", "a.", "b)", "B)", etc.
   - Example: "a) blood" → "blood"
   - Example: "A. environment" → "environment"
   - Keep the actual option content intact
5. DO NOT modify or interpret the option content

ANSWER EXTRACTION PROCESS:
1. After extracting all options, look for the answer indicator
2. If answer is a letter (a/b/c/d or A/B/C/D), note which letter it is
3. If answer is a number (1/2/3/4), note which number
4. If answer is the actual option text, note the exact text
5. Match the answer to the correct option index (0=first, 1=second, 2=third, 3=fourth)

RESPONSE FORMAT - YOU MUST USE "correctAnswerIndex" NOT "correctAnswer":
- Use "correctAnswerIndex" (0, 1, 2, or 3) to indicate which option is correct
- 0 = first option (a/A/1), 1 = second option (b/B/2), 2 = third option (c/C/3), 3 = fourth option (d/D/4)
- Set answerMarkedInDocument to true ONLY if you found explicit answer marking

RESPONSE FORMAT:
Return ONLY a valid JSON array with NO markdown, NO explanations, NO code blocks.
USE correctAnswerIndex (0-3) NOT correctAnswer!

[
  {
    "question": "question text here",
    "options": ["option 1 content", "option 2 content", "option 3 content", "option 4 content"],
    "correctAnswerIndex": 1,
    "answerMarkedInDocument": true,
    "answerRaw": "b",
    "answerNote": "Found as 'Ans.= b' in document"
  }
]

Example conversions:
- "Ans.= a" → correctAnswerIndex: 0
- "Answer: B" → correctAnswerIndex: 1  
- "Ans: c" → correctAnswerIndex: 2
- "Correct Answer: 4" → correctAnswerIndex: 3

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
              content: 'You are a JSON-only response bot. CRITICAL: Return correctAnswerIndex (0-3) not correctAnswer. Extract the EXACT answer indicator from the document. If you see "Ans.= a" or "Ans: a", set correctAnswerIndex to 0. If "Ans.= b" or "Answer: B", set correctAnswerIndex to 1. If "Ans: c" or "Answer: C", set correctAnswerIndex to 2. If "Ans.= d" or "Answer: D", set correctAnswerIndex to 3. If answer is a number like "1", "2", "3", "4", subtract 1 to get the index. Look for answer indicators like "Answer:", "Ans:", "Ans.=", "Correct Answer:". Return valid JSON array only, no markdown blocks, no explanations.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 20000, // Increased for more questions per chunk
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        console.error(`✗ Chunk ${i + 1} API ERROR: ${response.status} ${response.statusText}`);
        const errorData = await response.json().catch(() => ({}));
        console.error(`  Error details:`, errorData);
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
        console.log(`✓ Chunk ${i + 1} SUCCESS: Extracted ${extractedQuestions.length} questions`);
        console.log(`  Running total: ${allQuestions.length} questions`);
        // Log first question's answer for debugging
        if (extractedQuestions.length > 0) {
          console.log(`  Sample Q: Answer="${extractedQuestions[0].correctAnswer}", Marked=${extractedQuestions[0].answerMarkedInDocument}`);
        }
      } else {
        console.error(`✗ Chunk ${i + 1} FAILED: Not an array`);
      }
    } catch (error) {
      console.error(`Error processing chunk ${i + 1}:`, error);
      // Continue with next chunk
    }
  }
  
  console.log(`\n=== EXTRACTION COMPLETE ===`);
  console.log(`Total questions extracted from all chunks: ${allQuestions.length}`);
  console.log(`Chunks processed: ${chunks.length}`);
  console.log(`Document size: ${text.length} characters`);
  
  if (allQuestions.length === 0) {
    res.status(400).json({ error: 'No questions found in the document', questions: [] });
    return;
  }
  
  // Process and shuffle all questions
  const processedQuestions = allQuestions.map((q: any, idx: number) => {
    let correctIndex = -1;
    let verified = q.answerMarkedInDocument === true;
    
    // Prefer correctAnswerIndex if provided
    if (typeof q.correctAnswerIndex === 'number' && q.correctAnswerIndex >= 0 && q.correctAnswerIndex < q.options.length) {
      correctIndex = q.correctAnswerIndex;
      console.log(`Q${idx + 1}: Using correctAnswerIndex=${correctIndex}, Answer="${q.options[correctIndex]}"`);
    } 
    // Fallback to old correctAnswer matching
    else if (q.correctAnswer) {
      let correctAnswer = q.correctAnswer;
      
      // Log original answer for debugging
      if (idx < 3) {
        console.log(`Q${idx + 1}: Trying to match correctAnswer="${correctAnswer}", Options=[${q.options.join(', ')}]`);
      }
      
      correctIndex = q.options.findIndex((opt: string) => {
        const cleanOpt = opt.toLowerCase().trim().replace(/[^\w\s]/g, '');
        const cleanAnswer = correctAnswer.toLowerCase().trim().replace(/[^\w\s]/g, '');
        return cleanOpt === cleanAnswer || 
               cleanOpt.includes(cleanAnswer) || 
               cleanAnswer.includes(cleanOpt);
      });
      
      if (correctIndex === -1 && correctAnswer.length <= 2) {
        const answerChar = correctAnswer.toLowerCase().trim();
        // Try letter matching (a=0, b=1, c=2, d=3)
        if (answerChar >= 'a' && answerChar <= 'z') {
          const letterIndex = answerChar.charCodeAt(0) - 97;
          if (letterIndex >= 0 && letterIndex < q.options.length) {
            correctIndex = letterIndex;
            verified = true;
          }
        }
        // Try uppercase letter matching (A=0, B=1, C=2, D=3)
        else if (answerChar.toUpperCase() >= 'A' && answerChar.toUpperCase() <= 'Z') {
          const letterIndex = answerChar.toUpperCase().charCodeAt(0) - 65;
          if (letterIndex >= 0 && letterIndex < q.options.length) {
            correctIndex = letterIndex;
            verified = true;
          }
        }
        // Try number matching (1=0, 2=1, 3=2, 4=3)
        else if (answerChar >= '1' && answerChar <= '4') {
          const numberIndex = parseInt(answerChar) - 1;
          if (numberIndex >= 0 && numberIndex < q.options.length) {
            correctIndex = numberIndex;
            verified = true;
          }
        }
      }
    }
    
    // Fallback if still not found
    if (correctIndex === -1) {
      console.log(`⚠️ Warning: Could not determine answer for question ${idx + 1}, using first option`);
      correctIndex = 0;
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
    console.log(`Document length: ${text.length} characters`);
    
    // If document is very large, process in chunks
    if (text.length > 40000 || estimatedQuestions > 25) {
      console.log('Large document detected, using chunking strategy...');
      return await processLargeDocument(text, openRouterKey, res);
    }

    console.log('Small document, processing in single request...');

    try {
      const prompt = `You are a quiz extraction expert. Extract ALL multiple-choice questions from this document.

CRITICAL INSTRUCTIONS FOR ANSWER EXTRACTION - READ CAREFULLY:
1. Look for explicit answer indicators AFTER the options:
   - "Answer:", "Ans:", "Ans.=", "Ans =", "Correct Answer:", "ANS:", "Correct:", "Right Answer:", "Solution:"
   - Look for "Ans.= a", "Ans = b", "Answer: c", etc.
   - Answers in parentheses like "(Answer: B)" or "(Ans: d)"
   - Answer section at the end of questions
2. EXTRACT THE EXACT ANSWER VALUE:
   - If you see "Ans.= b" → extract "b" (lowercase)
   - If you see "Answer: B" → extract "B" (uppercase)
   - If you see "Ans: blood" → extract "blood"
   - If you see "Correct Answer: 2" → extract "2"
3. DO NOT GUESS - only extract if explicitly stated
4. Pay attention to letter case - preserve it exactly

QUESTION EXTRACTION RULES:
1. Extract EVERY SINGLE QUESTION - do not stop at 10 or 15 questions
2. Extract the exact question text (remove question numbers like "1)", "2)", "Q1:", etc.)
3. Extract ALL options exactly as written (usually 4 options: a, b, c, d OR A, B, C, D OR 1, 2, 3, 4)
4. Clean option text - remove ONLY prefixes like "a)", "A)", "1.", "a.", "b)", "B)", etc.
   - Example: "a) blood" → "blood"
   - Example: "A. environment" → "environment"
   - Keep the actual option content intact
5. DO NOT modify or interpret the option content

ANSWER EXTRACTION PROCESS:
1. After extracting all options, look for the answer indicator
2. If answer is a letter (a/b/c/d or A/B/C/D), note which letter it is
3. If answer is a number (1/2/3/4), note which number
4. If answer is the actual option text, note the exact text
5. Match the answer to the correct option index (0=first, 1=second, 2=third, 3=fourth)

RESPONSE FORMAT - YOU MUST USE "correctAnswerIndex" NOT "correctAnswer":
- Use "correctAnswerIndex" (0, 1, 2, or 3) to indicate which option is correct
- 0 = first option (a/A/1), 1 = second option (b/B/2), 2 = third option (c/C/3), 3 = fourth option (d/D/4)
- Set answerMarkedInDocument to true ONLY if you found explicit answer marking

RESPONSE FORMAT:
Return ONLY a valid JSON array with NO markdown, NO explanations, NO code blocks.
USE correctAnswerIndex (0-3) NOT correctAnswer!

[
  {
    "question": "question text here",
    "options": ["option 1 content", "option 2 content", "option 3 content", "option 4 content"],
    "correctAnswerIndex": 1,
    "answerMarkedInDocument": true,
    "answerRaw": "b",
    "answerNote": "Found as 'Ans.= b' in document"
  },
  ... (continue for ALL questions in document)
]

Example conversions:
- "Ans.= a" → correctAnswerIndex: 0
- "Answer: B" → correctAnswerIndex: 1  
- "Ans: c" → correctAnswerIndex: 2
- "Correct Answer: 4" → correctAnswerIndex: 3

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
              content: 'You are a JSON-only response bot. CRITICAL: Return correctAnswerIndex (0-3) not correctAnswer. Extract the EXACT answer indicator from the document. If you see "Ans.= a" or "Ans: a", set correctAnswerIndex to 0. If "Ans.= b" or "Answer: B", set correctAnswerIndex to 1. If "Ans: c" or "Answer: C", set correctAnswerIndex to 2. If "Ans.= d" or "Answer: D", set correctAnswerIndex to 3. If answer is a number like "1", "2", "3", "4", subtract 1 to get the index. Look for answer indicators like "Answer:", "Ans:", "Ans.=", "Correct Answer:". Return valid JSON array only, no markdown blocks, no explanations.'
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
          let correctIndex = -1;
          let verified = q.answerMarkedInDocument === true;
          
          // Prefer correctAnswerIndex if provided
          if (typeof q.correctAnswerIndex === 'number' && q.correctAnswerIndex >= 0 && q.correctAnswerIndex < q.options.length) {
            correctIndex = q.correctAnswerIndex;
            console.log(`Q${idx + 1}: Using correctAnswerIndex=${correctIndex}, Answer="${q.options[correctIndex]}"`);
          } 
          // Fallback to old correctAnswer matching
          else if (q.correctAnswer) {
            let correctAnswer = q.correctAnswer;
            
            // Log original answer for debugging
            if (idx < 3) {
              console.log(`Q${idx + 1}: Trying to match correctAnswer="${correctAnswer}", Options=[${q.options.join(', ')}]`);
            }
            
            correctIndex = q.options.findIndex((opt: string) => {
              const cleanOpt = opt.toLowerCase().trim().replace(/[^\w\s]/g, '');
              const cleanAnswer = correctAnswer.toLowerCase().trim().replace(/[^\w\s]/g, '');
              return cleanOpt === cleanAnswer || 
                     cleanOpt.includes(cleanAnswer) || 
                     cleanAnswer.includes(cleanOpt);
            });
            
            if (correctIndex === -1 && correctAnswer.length <= 2) {
              const answerChar = correctAnswer.toLowerCase().trim();
              // Try letter matching (a=0, b=1, c=2, d=3)
              if (answerChar >= 'a' && answerChar <= 'z') {
                const letterIndex = answerChar.charCodeAt(0) - 97;
                if (letterIndex >= 0 && letterIndex < q.options.length) {
                  correctIndex = letterIndex;
                  verified = true;
                  if (idx < 3) console.log(`Q${idx + 1}: Matched by letter "${answerChar}" -> index ${correctIndex}`);
                }
              }
              // Try uppercase letter matching (A=0, B=1, C=2, D=3)
              else if (answerChar.toUpperCase() >= 'A' && answerChar.toUpperCase() <= 'Z') {
                const letterIndex = answerChar.toUpperCase().charCodeAt(0) - 65;
                if (letterIndex >= 0 && letterIndex < q.options.length) {
                  correctIndex = letterIndex;
                  verified = true;
                  if (idx < 3) console.log(`Q${idx + 1}: Matched by UPPERCASE letter "${answerChar}" -> index ${correctIndex}`);
                }
              }
              // Try number matching (1=0, 2=1, 3=2, 4=3)
              else if (answerChar >= '1' && answerChar <= '4') {
                const numberIndex = parseInt(answerChar) - 1;
                if (numberIndex >= 0 && numberIndex < q.options.length) {
                  correctIndex = numberIndex;
                  verified = true;
                  if (idx < 3) console.log(`Q${idx + 1}: Matched by number "${answerChar}" -> index ${correctIndex}`);
                }
              }
            }
          }
          
          // Fallback if still not found
          if (correctIndex === -1) {
            console.log(`⚠️ Warning: Could not determine answer for question ${idx + 1}, using first option`);
            correctIndex = 0;
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
