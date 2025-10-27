import { useState, useRef } from 'react';
import Head from 'next/head';
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Brain,
  ArrowRight,
  RotateCcw,
  Award,
  XCircle,
  Download
} from 'lucide-react';

interface Question {
  question: string;
  options: string[];
  correctAnswer: string;
  originalIndex?: number;
}

interface UserAnswer {
  questionIndex: number;
  selectedAnswer: string;
  isCorrect: boolean;
}

export default function QuizPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState('');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<UserAnswer[]>([]);
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [showResult, setShowResult] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelection(droppedFile);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelection(selectedFile);
    }
  };

  const handleFileSelection = (selectedFile: File) => {
    const validTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/msword'
    ];

    if (!validTypes.includes(selectedFile.type) && 
        !selectedFile.name.match(/\.(pdf|docx|txt|doc)$/i)) {
      setError('Please upload a PDF, DOCX, or TXT file');
      return;
    }

    setFile(selectedFile);
    setError('');
    setQuestions([]);
    setUserAnswers([]);
    setQuizCompleted(false);
  };

  const handleGenerateQuiz = async () => {
    if (!file) return;

    setIsProcessing(true);
    setError('');
    setQuestions([]);
    setUserAnswers([]);
    setQuizCompleted(false);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const extractResponse = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      });

      if (!extractResponse.ok) {
        const errorData = await extractResponse.json();
        throw new Error(errorData.error || 'Failed to extract text from document');
      }

      const { text } = await extractResponse.json();

      const quizResponse = await fetch('/api/summarize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!quizResponse.ok) {
        const errorData = await quizResponse.json();
        throw new Error(errorData.error || 'Failed to extract questions');
      }

      const { questions: extractedQuestions } = await quizResponse.json();
      
      if (!extractedQuestions || extractedQuestions.length === 0) {
        throw new Error('No questions found in the document. Make sure the document contains multiple-choice questions.');
      }

      setQuestions(extractedQuestions);
      setCurrentQuestionIndex(0);
      setSelectedOption('');
      setShowResult(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAnswerSelect = (option: string) => {
    if (!showResult) {
      setSelectedOption(option);
    }
  };

  const handleSubmitAnswer = () => {
    if (!selectedOption) return;

    const currentQuestion = questions[currentQuestionIndex];
    const isCorrect = selectedOption === currentQuestion.correctAnswer;

    setUserAnswers([...userAnswers, {
      questionIndex: currentQuestionIndex,
      selectedAnswer: selectedOption,
      isCorrect
    }]);

    setShowResult(true);
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOption('');
      setShowResult(false);
    } else {
      setQuizCompleted(true);
    }
  };

  const handleRestartQuiz = () => {
    setCurrentQuestionIndex(0);
    setUserAnswers([]);
    setSelectedOption('');
    setShowResult(false);
    setQuizCompleted(false);
  };

  const handleReset = () => {
    setFile(null);
    setQuestions([]);
    setError('');
    setUserAnswers([]);
    setCurrentQuestionIndex(0);
    setSelectedOption('');
    setShowResult(false);
    setQuizCompleted(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const calculateScore = () => {
    const correct = userAnswers.filter((a: UserAnswer) => a.isCorrect).length;
    const total = userAnswers.length;
    return { correct, total, percentage: total > 0 ? Math.round((correct / total) * 100) : 0 };
  };

  const downloadResults = () => {
    const score = calculateScore();
    let content = `Quiz Results\n`;
    content += `Score: ${score.correct}/${score.total} (${score.percentage}%)\n`;
    content += `\n${'='.repeat(50)}\n\n`;

    questions.forEach((q: Question, idx: number) => {
      const userAnswer = userAnswers.find((a: UserAnswer) => a.questionIndex === idx);
      content += `Question ${idx + 1}: ${q.question}\n\n`;
      q.options.forEach((opt: string, i: number) => {
        const marker = opt === q.correctAnswer ? '✓' : ' ';
        const selected = userAnswer?.selectedAnswer === opt ? '→' : ' ';
        content += `  ${selected} ${String.fromCharCode(65 + i)}) ${opt} ${marker}\n`;
      });
      content += `\nYour answer: ${userAnswer?.selectedAnswer || 'Not answered'}\n`;
      content += `Correct answer: ${q.correctAnswer}\n`;
      content += `Result: ${userAnswer?.isCorrect ? '✓ Correct' : '✗ Incorrect'}\n`;
      content += `\n${'='.repeat(50)}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quiz_results_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentQuestion = questions[currentQuestionIndex];
  const score = calculateScore();

  return (
    <>
      <Head>
        <title>PDF Qutor - AI Quiz Generator</title>
        <meta name="description" content="Extract questions from documents and take interactive quizzes" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50">
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="text-center mb-12">
            <div className="flex items-center justify-center mb-4">
              <Brain className="w-10 h-10 text-indigo-600 mr-3" />
              <h1 className="text-5xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                PDF Qutor
              </h1>
            </div>
            <p className="text-gray-600 text-lg">
              AI-powered quiz generator from your documents - No login required
            </p>
          </div>

          {questions.length === 0 && !quizCompleted && (
            <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-3 border-dashed rounded-xl p-12 text-center transition-all duration-300 ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-50 scale-105'
                    : 'border-gray-300 hover:border-indigo-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.txt,.doc"
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-upload"
                />
                
                {!file ? (
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Upload className="w-16 h-16 mx-auto mb-4 text-indigo-500" />
                    <p className="text-xl font-semibold text-gray-700 mb-2">
                      Upload your quiz document
                    </p>
                    <p className="text-sm text-gray-500">
                      Supports PDF, DOCX, TXT files with multiple-choice questions
                    </p>
                  </label>
                ) : (
                  <div className="space-y-4">
                    <FileText className="w-16 h-16 mx-auto text-green-500" />
                    <div className="bg-gray-50 rounded-lg p-4 max-w-md mx-auto">
                      <p className="font-semibold text-gray-800 truncate">{file.name}</p>
                      <p className="text-sm text-gray-500">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={handleGenerateQuiz}
                        disabled={isProcessing}
                        className="px-8 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-all duration-300 flex items-center gap-2 shadow-lg hover:shadow-xl"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Extracting Questions...
                          </>
                        ) : (
                          <>
                            <Brain className="w-5 h-5" />
                            Generate Quiz
                          </>
                        )}
                      </button>
                      <button
                        onClick={handleReset}
                        disabled={isProcessing}
                        className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 disabled:bg-gray-100 transition-all duration-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-lg mb-8 flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-red-800 mb-1">Error</h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="bg-white rounded-2xl shadow-xl p-8">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
                <div className="text-center">
                  <p className="text-lg font-semibold text-gray-800 mb-2">
                    Analyzing your document...
                  </p>
                  <p className="text-sm text-gray-500">Extracting questions and answers with AI</p>
                </div>
              </div>
            </div>
          )}

          {questions.length > 0 && !quizCompleted && currentQuestion && (
            <div className="bg-white rounded-2xl shadow-xl p-8 animate-fadeIn">
              <div className="mb-6">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>Question {currentQuestionIndex + 1} of {questions.length}</span>
                  <span>{userAnswers.length} answered</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${((currentQuestionIndex + 1) / questions.length) * 100}%` }}
                  />
                </div>
              </div>

              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-6">
                  {currentQuestion.question}
                </h2>

                <div className="space-y-3">
                  {currentQuestion.options.map((option: string, idx: number) => {
                    const isSelected = selectedOption === option;
                    const isCorrect = option === currentQuestion.correctAnswer;
                    const showCorrectAnswer = showResult && isCorrect;
                    const showWrongAnswer = showResult && isSelected && !isCorrect;

                    return (
                      <button
                        key={idx}
                        onClick={() => handleAnswerSelect(option)}
                        disabled={showResult}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-all duration-300 ${
                          showCorrectAnswer
                            ? 'border-green-500 bg-green-50'
                            : showWrongAnswer
                            ? 'border-red-500 bg-red-50'
                            : isSelected
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
                        } ${showResult ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                              showCorrectAnswer
                                ? 'bg-green-500 text-white'
                                : showWrongAnswer
                                ? 'bg-red-500 text-white'
                                : isSelected
                                ? 'bg-indigo-500 text-white'
                                : 'bg-gray-200 text-gray-700'
                            }`}>
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="text-gray-800">{option}</span>
                          </div>
                          {showCorrectAnswer && <CheckCircle className="w-6 h-6 text-green-500" />}
                          {showWrongAnswer && <XCircle className="w-6 h-6 text-red-500" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                {!showResult ? (
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={!selectedOption}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all duration-300 flex items-center gap-2"
                  >
                    Check Answer
                    <ArrowRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    onClick={handleNextQuestion}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all duration-300 flex items-center gap-2"
                  >
                    {currentQuestionIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
                    <ArrowRight className="w-5 h-5" />
                  </button>
                )}
              </div>

              {showResult && (
                <div className={`mt-6 p-4 rounded-lg ${
                  selectedOption === currentQuestion.correctAnswer
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
                }`}>
                  <p className={`font-semibold ${
                    selectedOption === currentQuestion.correctAnswer
                      ? 'text-green-800'
                      : 'text-red-800'
                  }`}>
                    {selectedOption === currentQuestion.correctAnswer
                      ? '✓ Correct! Well done!'
                      : `✗ Incorrect. The correct answer is: ${currentQuestion.correctAnswer}`
                    }
                  </p>
                </div>
              )}
            </div>
          )}

          {quizCompleted && (
            <div className="bg-white rounded-2xl shadow-xl p-8 animate-fadeIn">
              <div className="text-center mb-8">
                <Award className="w-20 h-20 mx-auto mb-4 text-yellow-500" />
                <h2 className="text-3xl font-bold text-gray-800 mb-2">Quiz Completed!</h2>
                <p className="text-gray-600">Here's how you did</p>
              </div>

              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-8 mb-8">
                <div className="text-center">
                  <div className="text-6xl font-bold text-indigo-600 mb-2">
                    {score.percentage}%
                  </div>
                  <div className="text-xl text-gray-700">
                    {score.correct} out of {score.total} correct
                  </div>
                  <div className="mt-4">
                    {score.percentage === 100 && (
                      <span className="inline-block bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full font-semibold">
                        🎉 Perfect Score!
                      </span>
                    )}
                    {score.percentage >= 80 && score.percentage < 100 && (
                      <span className="inline-block bg-green-100 text-green-800 px-4 py-2 rounded-full font-semibold">
                        🌟 Great Job!
                      </span>
                    )}
                    {score.percentage >= 60 && score.percentage < 80 && (
                      <span className="inline-block bg-blue-100 text-blue-800 px-4 py-2 rounded-full font-semibold">
                        👍 Good Work!
                      </span>
                    )}
                    {score.percentage < 60 && (
                      <span className="inline-block bg-orange-100 text-orange-800 px-4 py-2 rounded-full font-semibold">
                        💪 Keep Practicing!
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4 mb-8">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Review Your Answers</h3>
                {questions.map((q: Question, idx: number) => {
                  const userAnswer = userAnswers.find((a: UserAnswer) => a.questionIndex === idx);
                  return (
                    <div key={idx} className={`p-4 rounded-lg border-2 ${
                      userAnswer?.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                    }`}>
                      <div className="flex items-start gap-3">
                        {userAnswer?.isCorrect ? (
                          <CheckCircle className="w-6 h-6 text-green-500 flex-shrink-0 mt-1" />
                        ) : (
                          <XCircle className="w-6 h-6 text-red-500 flex-shrink-0 mt-1" />
                        )}
                        <div className="flex-1">
                          <p className="font-semibold text-gray-800 mb-2">
                            Question {idx + 1}: {q.question}
                          </p>
                          <p className="text-sm text-gray-600">
                            Your answer: <span className={userAnswer?.isCorrect ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>
                              {userAnswer?.selectedAnswer}
                            </span>
                          </p>
                          {!userAnswer?.isCorrect && (
                            <p className="text-sm text-gray-600 mt-1">
                              Correct answer: <span className="text-green-700 font-semibold">{q.correctAnswer}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-3 justify-center flex-wrap">
                <button
                  onClick={handleRestartQuiz}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all duration-300 flex items-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" />
                  Retake Quiz
                </button>
                <button
                  onClick={downloadResults}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all duration-300 flex items-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download Results
                </button>
                <button
                  onClick={handleReset}
                  className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition-all duration-300"
                >
                  New Quiz
                </button>
              </div>
            </div>
          )}

          <div className="text-center mt-12 text-gray-500 text-sm">
            <p>Powered by Google AI & OpenRouter · Your documents are processed securely and not stored</p>
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out;
        }
      `}</style>
    </>
  );
}
