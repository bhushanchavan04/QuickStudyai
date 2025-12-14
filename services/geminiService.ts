
import { GoogleGenAI, Type, GenerateContentResponse, Chat } from "@google/genai";
import { AnalysisResult } from '../types.ts';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // remove 'data:*/*;base64,' prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });
};

const analysisSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: "A comprehensive summary of the question paper. Structure this in clear, well-separated paragraphs. Do not use bullet points here; use full sentences to describe the scope and difficulty in a narrative flow."
    },
    keyConcepts: {
      type: Type.ARRAY,
      description: "A list of 3-6 key concepts or chapters that are most important in this paper, serving as a study guide.",
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: "The name of the topic or concept (e.g., 'Thermodynamics', 'Linear Algebra')."
          },
          description: {
            type: Type.STRING,
            description: "A brief advice on why this is important and what to focus on."
          },
          importance: {
            type: Type.STRING,
            enum: ["High", "Medium", "Low"],
            description: "The relative importance based on marks weightage."
          }
        },
        required: ["name", "description", "importance"]
      }
    },
    questions: {
      type: Type.ARRAY,
      description: "An array of detailed analyses for each question found in the paper.",
      items: {
        type: Type.OBJECT,
        properties: {
          questionNumber: {
            type: Type.STRING,
            description: "The number or identifier of the question (e.g., '1a', '2', 'Section B Q1')."
          },
          questionText: {
            type: Type.STRING,
            description: "The full and exact text of the question as it appears on the paper."
          },
          mainTopic: {
            type: Type.STRING,
            description: "The core academic topic or concept being tested by the question."
          },
          marks: {
            type: Type.NUMBER,
            description: "The marks allocated to the question. If not specified, estimate based on the question's length and complexity."
          },
          difficulty: {
            type: Type.STRING,
            description: "The difficulty level of the question, classified as 'Easy', 'Medium', or 'Hard'."
          },
          correctAnswer: {
            type: Type.STRING,
            description: "A detailed, correct answer formatted in a clear, point-wise style using Markdown. Start with a brief introductory sentence, then use bullet points for the main explanation, steps, or facts. Use bold formatting for keywords. Ensure the answer is structured logically and is easy to scan."
          },
          similarQuestions: {
            type: Type.ARRAY,
            description: "An array of 2 new, similar practice questions that test the same main topic.",
            items: {
              type: Type.STRING
            }
          }
        },
        required: ["questionNumber", "questionText", "mainTopic", "marks", "difficulty", "correctAnswer", "similarQuestions"]
      }
    }
  },
  required: ["summary", "keyConcepts", "questions"]
};

export const analyzeQuestionPapersStream = async (imageFiles: File[]): Promise<AsyncGenerator<GenerateContentResponse>> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  try {
    const base64DataPromises = imageFiles.map(file => fileToBase64(file));
    const base64DataParts = await Promise.all(base64DataPromises);

    const imageParts = imageFiles.map((file, index) => ({
      inlineData: {
        mimeType: file.type,
        data: base64DataParts[index]
      }
    }));

    const prompt = `
      You are an expert academic analyst acting as a professional tutor. Your goal is to analyze the provided question paper images and output a structured, neat, and easy-to-read response.

      **Instructions for Content Generation:**

      1.  **Overall Summary:**
          - Write a comprehensive overview of the paper's coverage and difficulty.
          - **Format:** Use clear, distinct paragraphs. Do NOT use bullet points for the summary. Write in a flowing, narrative style.

      2.  **Key Concepts (Study Guide):**
          - Identify the 3-6 most critical topics based on the questions.
          - Rate their importance (High/Medium/Low) based on marks.
          - Provide brief study advice for each.

      3.  **Question Analysis:**
          - Identify every question in the paper.
          - Extract the text verbatim.
          - Determine the topic, marks, and difficulty.

      4.  **Correct Answer (Crucial):**
          - Provide a detailed solution for each question.
          - **Format:** **Point-wise and Structured.**
          - **MANDATORY:** Use bullet points for the answer content.
          - Break down complex explanations into clear steps or distinct points.
          - Use bold text for key terms to improve readability.
          - The tone should be educational and clear.

      5.  **Similar Questions:**
          - Generate 2 practice questions for each analyzed question.

      **Output:**
      - Return a single valid JSON object matching the defined schema.
      - Ensure all content is neat, clean, and well-spaced.
    `;

    const allParts = [...imageParts, { text: prompt }];

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: { parts: allParts },
      config: {
        responseMimeType: "application/json",
        responseSchema: analysisSchema
      }
    });
    
    return responseStream;

  } catch (error) {
    console.error("Error analyzing question paper:", error);
    throw new Error("Failed to analyze the document. The AI model could not process the request.");
  }
};

export const startChatSession = (analysisContext: AnalysisResult): Chat => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable is not set.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Construct a context string from the analysis result
    const contextString = `
    You are a helpful AI tutor for a student. 
    The student has uploaded a question paper which has been analyzed. 
    Here is the data from that analysis:

    SUMMARY:
    ${analysisContext.summary}

    KEY STUDY TOPICS:
    ${analysisContext.keyConcepts.map(k => `- ${k.name} (${k.importance}): ${k.description}`).join('\n')}

    QUESTIONS AND ANSWERS:
    ${analysisContext.questions.map(q => `
    - Question ${q.questionNumber} (${q.mainTopic}, ${q.difficulty}): "${q.questionText}"
      Answer: ${q.correctAnswer}
    `).join('\n')}

    Your goal is to answer any follow-up questions the student has about this paper, the specific questions, or the topics covered.
    Provide answers in a neat, paragraph-wise format. Be concise, helpful, and encouraging.
    `;

    return ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: contextString,
        }
    });
};
