
export interface QuestionAnalysis {
  questionNumber: string;
  questionText: string;
  mainTopic: string;
  marks: number;
  difficulty: string;
  correctAnswer: string;
  similarQuestions: string[];
}

export interface KeyConcept {
  name: string;
  description: string;
  importance: 'High' | 'Medium' | 'Low';
}

export interface AnalysisResult {
  summary: string;
  keyConcepts: KeyConcept[];
  questions: QuestionAnalysis[];
}
