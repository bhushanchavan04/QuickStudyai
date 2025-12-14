
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { analyzeQuestionPapersStream, startChatSession } from '../services/geminiService.ts';
import { loginWithGoogle, logoutUser } from '../services/firebase.ts';
import { AnalysisResult, QuestionAnalysis, KeyConcept } from '../types.ts';
import { XIcon, AlertTriangleIcon, SunIcon, MoonIcon, BookOpenIcon, ChevronDownIcon, UploadIcon, ChatBubbleIcon, SendIcon, MinusIcon, SearchIcon, SparklesIcon, MenuIcon, PlusIcon, MessageSquareIcon, TrashIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, GoogleIcon, BrainIcon, ChartBarIcon, CheckCircleIcon, StarIcon, ShieldIcon, ZapIcon, LayersIcon, UsersIcon, CheckIcon } from './icons.tsx';
import { Chat, GenerateContentResponse } from "@google/genai";

// == Helper Types ==
interface TopicWeightage {
    count: number;
    marks: number;
}
type Theme = 'light' | 'dark';

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
}

interface HistoryItem {
    id: string;
    title: string;
    date: number;
    analysisResult: AnalysisResult;
}

interface User {
    name: string;
    email: string;
    avatar: string;
}

// == Helper Functions & Global Configs ==
function parseStreamingJson(jsonString: string): AnalysisResult {
    const result: AnalysisResult = { summary: "", keyConcepts: [], questions: [] };
    
    // Parse Summary
    const summaryMatch = jsonString.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (summaryMatch && summaryMatch[1]) {
        try {
            result.summary = JSON.parse(`"${summaryMatch[1]}"`);
        } catch {
            result.summary = summaryMatch[1];
        }
    }

    // Parse Key Concepts (Array of Objects)
    const keyConceptsStartIndex = jsonString.indexOf('"keyConcepts"');
    if (keyConceptsStartIndex > -1) {
        const arrayStartIndex = jsonString.indexOf('[', keyConceptsStartIndex);
        if (arrayStartIndex > -1) {
             const potentialArrayContent = jsonString.substring(arrayStartIndex);
             try {
                // Try complete parse
                const concepts = JSON.parse(potentialArrayContent.replace(/,\]$/, ']'));
                if (Array.isArray(concepts)) result.keyConcepts = concepts;
             } catch (e) {
                // Partial parse
                let braceCount = 0;
                let currentObjectString = '';
                for (const char of potentialArrayContent.substring(1)) {
                    if (char === '{') braceCount++;
                    if (braceCount > 0) currentObjectString += char;
                    if (char === '}') {
                        braceCount--;
                        if (braceCount === 0 && currentObjectString.length > 0) {
                            try {
                                const concept = JSON.parse(currentObjectString);
                                if (!result.keyConcepts.some(c => c.name === concept.name)) {
                                    result.keyConcepts.push(concept);
                                }
                            } catch (e) {}
                            currentObjectString = '';
                        }
                    }
                    if (braceCount === 0 && char === ']') break;
                }
             }
        }
    }

    // Parse Questions
    const questionsStartIndex = jsonString.indexOf('"questions"');
    if (questionsStartIndex > -1) {
        const arrayStartIndex = jsonString.indexOf('[', questionsStartIndex);
        if (arrayStartIndex > -1) {
            const potentialArrayContent = jsonString.substring(arrayStartIndex);
            try {
                 const questions = JSON.parse(potentialArrayContent.replace(/,\]$/, ']'));
                 if (Array.isArray(questions)) {
                     result.questions = questions;
                 }
            } catch (e) {
                let braceCount = 0;
                let currentObjectString = '';
                for (const char of potentialArrayContent.substring(1)) {
                    if (char === '{') braceCount++;
                    if (braceCount > 0) currentObjectString += char;
                    if (char === '}') {
                        braceCount--;
                        if (braceCount === 0 && currentObjectString.length > 0) {
                            try {
                                const question = JSON.parse(currentObjectString);
                                if (!result.questions.some(q => q.questionNumber === question.questionNumber)) {
                                     result.questions.push(question);
                                }
                            } catch (parseError) {}
                            currentObjectString = '';
                        }
                    }
                }
            }
        }
    }
    return result;
}

// Configure marked library once
const renderer = new marked.Renderer();
renderer.code = (token) => {
  const { text: code, lang: language } = token;
  const validLanguage = language && language.match(/\w+/) ? language : 'plaintext';
  return `<pre class="bg-slate-100 dark:bg-slate-900 rounded-md p-3 text-sm overflow-x-auto"><code class="language-${validLanguage}">${code}</code></pre>`;
};
marked.setOptions({ renderer });


// == UI Components ==

const Sidebar: React.FC<{
    isOpen: boolean;
    isDesktopCollapsed: boolean;
    history: HistoryItem[];
    currentId: string | null;
    user: User | null;
    onSelect: (item: HistoryItem) => void;
    onNewChat: () => void;
    onDelete: (id: string, e: React.MouseEvent) => void;
    toggleSidebar: () => void;
    toggleDesktopCollapse: () => void;
    onLogout: () => void;
}> = ({ isOpen, isDesktopCollapsed, history, currentId, user, onSelect, onNewChat, onDelete, toggleSidebar, toggleDesktopCollapse, onLogout }) => {
    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/50 z-20 md:hidden"
                    onClick={toggleSidebar}
                ></div>
            )}
            
            <aside className={`
                fixed md:static inset-y-0 left-0 z-30
                bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col
                transition-all duration-300 ease-in-out
                ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                ${isDesktopCollapsed ? 'md:w-0' : 'md:w-[260px]'}
                w-[260px] flex-shrink-0 overflow-hidden border-r border-slate-200 dark:border-slate-800
            `}>
                <div className="w-[260px] h-full flex flex-col">
                    <div className="p-3 flex justify-between items-center gap-2">
                        <button 
                            onClick={() => { onNewChat(); if(window.innerWidth < 768) toggleSidebar(); }}
                            className="flex-1 flex items-center gap-3 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-sm text-left truncate text-slate-700 dark:text-slate-200"
                            title="New Analysis"
                        >
                            <PlusIcon className="w-5 h-5 shrink-0" />
                            <span className="truncate">New Analysis</span>
                        </button>
                        
                        <button 
                            onClick={toggleDesktopCollapse} 
                            className="hidden md:flex p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors rounded-md hover:bg-slate-200 dark:hover:bg-slate-800"
                            title="Close Sidebar"
                        >
                            <PanelLeftCloseIcon className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                        {history.length === 0 && (
                            <div className="text-xs text-slate-400 dark:text-slate-500 text-center mt-4">
                                No past analyses
                            </div>
                        )}
                        
                        <div className="flex flex-col gap-1">
                            {history.map((item) => (
                                <div 
                                    key={item.id}
                                    onClick={() => { onSelect(item); if(window.innerWidth < 768) toggleSidebar(); }}
                                    className={`
                                        group flex items-center gap-3 px-3 py-3 rounded-md cursor-pointer text-sm relative
                                        ${currentId === item.id ? 'bg-slate-200 dark:bg-slate-800' : 'hover:bg-slate-200/50 dark:hover:bg-slate-800/50'}
                                    `}
                                    title={item.title}
                                >
                                    <MessageSquareIcon className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" />
                                    <div className="flex-1 truncate pr-6 text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white">
                                        {item.title}
                                    </div>
                                    <button 
                                        onClick={(e) => onDelete(item.id, e)}
                                        className="absolute right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-opacity p-1"
                                        title="Delete"
                                    >
                                        <TrashIcon className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                         {user ? (
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 overflow-hidden">
                                     <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 text-white overflow-hidden">
                                        {user.avatar ? <img src={user.avatar} alt={user.name} className="w-full h-full object-cover"/> : user.name.charAt(0)}
                                    </div>
                                    <div className="text-sm font-medium truncate text-slate-700 dark:text-slate-200">{user.name}</div>
                                </div>
                                <button onClick={onLogout} className="text-xs text-slate-500 hover:text-red-500">Sign Out</button>
                            </div>
                        ) : (
                             <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold shrink-0 text-white">
                                    QA
                                </div>
                                <div className="text-sm font-medium truncate text-slate-700 dark:text-slate-200">Guest User</div>
                            </div>
                        )}
                    </div>
                </div>
            </aside>
        </>
    );
}

const Header: React.FC<{ 
    theme: Theme; 
    onThemeChange: () => void; 
    toggleSidebar: () => void;
    isDesktopCollapsed: boolean;
    toggleDesktopCollapse: () => void;
}> = ({ theme, onThemeChange, toggleSidebar, isDesktopCollapsed, toggleDesktopCollapse }) => (
    <header className="w-full border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white dark:bg-black z-10 transition-all">
        <div className="w-full px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
                <div className="flex items-center gap-3">
                    <button 
                        onClick={toggleSidebar}
                        className="md:hidden p-2 -ml-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md"
                    >
                        <MenuIcon className="w-6 h-6" />
                    </button>

                    {/* Desktop Toggle Button - Only visible when collapsed */}
                    <button 
                        onClick={toggleDesktopCollapse}
                        className={`hidden md:flex p-2 -ml-2 mr-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-all duration-200 ${isDesktopCollapsed ? 'opacity-100 w-auto' : 'opacity-0 pointer-events-none w-0 p-0 overflow-hidden'}`}
                        title="Open Sidebar"
                    >
                        <PanelLeftOpenIcon className="w-6 h-6" />
                    </button>

                    <div className="flex items-center gap-2">
                         <BookOpenIcon className="w-7 h-7 text-indigo-600 dark:text-indigo-500" />
                        <h1 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-200 hidden sm:block">
                            QuickStudy AI
                        </h1>
                    </div>
                </div>
                <button
                    onClick={onThemeChange}
                    className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="Toggle theme"
                >
                    {theme === 'dark' ? <SunIcon className="w-6 h-6" /> : <MoonIcon className="w-6 h-6" />}
                </button>
            </div>
        </div>
    </header>
);

const LandingPage: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
    return (
        <div className="min-h-screen bg-[#0B0C15] text-white font-sans selection:bg-indigo-500 selection:text-white overflow-x-hidden">
            
            {/* Background Gradients */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] right-[-5%] w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[120px]"></div>
                <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-600/10 rounded-full blur-[100px]"></div>
            </div>

            {/* Header */}
            <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-[#0B0C15]/70 border-b border-white/5 shadow-sm">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
                            <BookOpenIcon className="w-6 h-6" />
                        </div>
                        <span className="text-2xl font-bold tracking-tight text-white">QuickStudy AI</span>
                    </div>
                    
                    <nav className="hidden md:flex items-center gap-8 font-medium text-slate-300">
                        <a href="#features" className="hover:text-white transition-colors">Features</a>
                        <a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a>
                        
                    </nav>

                    
                </div>
            </header>

            {/* Hero Section */}
            <section className="relative z-10 pt-20 pb-32 px-6">
                <div className="max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-16">
                    
                    {/* Left Content */}
                    <div className="flex-1 text-center lg:text-left space-y-8">
                        {/* Badge */}
                        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm font-medium text-indigo-300 backdrop-blur-sm">
                            <SparklesIcon className="w-4 h-4" />
                            <span>AI-Powered Exam Prep for Everyone</span>
                        </div>
                        
                        {/* Headline */}
                        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] text-white">
                            Analyze Question Papers in <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Seconds.</span>
                        </h1>
                        
                        {/* Subhead */}
                        <p className="text-xl text-slate-400 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                            Upload your Previous Year Questions (PYQ). Let AI break down topics, estimate difficulty, and generate instant answers & similar questions.
                        </p>

                        {/* CTA Button */}
                        <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start pt-4">
                            <button 
                                onClick={onLogin}
                                className="flex items-center gap-3 bg-[#1E2335] border border-slate-700 hover:border-indigo-500/50 hover:bg-slate-800 text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300 group shadow-lg"
                            >
                                
                                <span>Analyze Now </span>
                                <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
                            </button>
                        </div>
                    </div>

                    {/* Right Visual - Scanning Animation */}
                    <div className="flex-1 w-full max-w-[650px] relative perspective-1000">
                        <style>{`
                            @keyframes scan-line {
                                0% { top: 0%; opacity: 0; }
                                15% { opacity: 1; }
                                85% { opacity: 1; }
                                100% { top: 100%; opacity: 0; }
                            }
                        `}</style>
                        
                        {/* Glow behind */}
                        <div className="absolute inset-0 bg-indigo-600/20 rounded-3xl blur-3xl transform translate-y-4 scale-95 animate-pulse"></div>
                        
                        {/* Main Window */}
                        <div className="relative bg-[#131520] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[400px]">
                            {/* Window Controls */}
                            <div className="px-4 py-4 border-b border-slate-800 flex gap-2 bg-[#1A1D29] shrink-0 z-20">
                                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                <div className="ml-4 text-xs text-slate-500 font-mono">quickstudy_analyzer.exe</div>
                            </div>

                            {/* Canvas Area */}
                            <div className="relative flex-1 bg-[#0B0C15] p-8 overflow-hidden flex items-center justify-center">
                                
                                {/* The Document - REPLACED WITH REAL DUMMY PYQ */}
                                <div className="relative w-full max-w-[340px] bg-white dark:bg-[#1E2335] rounded-sm shadow-2xl border border-slate-200 dark:border-slate-700 p-6 z-10 transform rotate-[-2deg] transition-transform duration-700 hover:rotate-0 font-serif min-h-[420px]">
                                    
                                    {/* Exam Header */}
                                    <div className="text-center border-b-2 border-slate-800 dark:border-slate-500 pb-4 mb-5">
                                        <div className="flex justify-center mb-2">
                                            <div className="w-8 h-8 rounded-full border-2 border-slate-800 dark:border-slate-400 flex items-center justify-center">
                                                 <span className="font-bold text-xs text-slate-800 dark:text-slate-300">U</span>
                                            </div>
                                        </div>
                                        <h3 className="font-bold text-sm uppercase tracking-widest text-slate-900 dark:text-white">University Examination</h3>
                                        <p className="text-[10px] text-slate-500 mt-1 font-sans uppercase tracking-wider">B.Tech - Semester IV • May 2024</p>
                                    </div>

                                    {/* Paper Metadata */}
                                    <div className="flex justify-between text-[10px] font-sans font-bold text-slate-600 dark:text-slate-400 mb-6 border-b border-dashed border-slate-300 dark:border-slate-700 pb-2">
                                        <span>Subject: Thermodynamics</span>
                                        <span>Max Marks: 100</span>
                                    </div>

                                    {/* Paper Content */}
                                    <div className="space-y-5 text-xs text-slate-800 dark:text-slate-300">
                                        {/* Section A */}
                                        <div>
                                            <div className="font-sans font-bold text-slate-900 dark:text-white mb-3 text-[11px] uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 inline-block">Part A</div>
                                            <div className="space-y-3">
                                                <div className="flex gap-2">
                                                    <span className="font-bold">1.</span>
                                                    <p className="leading-snug">State the <span className="font-semibold text-indigo-600 dark:text-indigo-400">Zeroth Law</span> of thermodynamics and explain its significance in temperature measurement.</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <span className="font-bold">2.</span>
                                                    <p className="leading-snug">Define <span className="italic">Enthalpy</span>. Show that for an ideal gas, internal energy depends only on temperature.</p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Section B with Math/Diagram Placeholder */}
                                        <div>
                                             <div className="font-sans font-bold text-slate-900 dark:text-white mb-3 mt-2 text-[11px] uppercase tracking-wide border-b border-slate-200 dark:border-slate-700 inline-block">Part B</div>
                                             <div className="space-y-3">
                                                <div className="flex gap-2">
                                                    <span className="font-bold">3.</span>
                                                    <div className="space-y-2 w-full">
                                                        <p className="leading-snug">A Carnot engine operates between two reservoirs at temperatures T1 and T2.</p>
                                                        
                                                        {/* Mock Equation/Diagram */}
                                                        <div className="w-full bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700 p-2 flex items-center justify-center gap-3">
                                                            <div className="h-8 w-8 rounded-full border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[9px]">T1</div>
                                                            <div className="h-0.5 w-6 bg-slate-300 dark:bg-slate-600"></div>
                                                            <div className="h-8 w-8 border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[9px]">W</div>
                                                             <div className="h-0.5 w-6 bg-slate-300 dark:bg-slate-600"></div>
                                                            <div className="h-8 w-8 rounded-full border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[9px]">T2</div>
                                                        </div>

                                                        <p className="text-[10px] text-slate-500 text-right font-sans font-bold">(15 Marks)</p>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Scanning Laser Effect */}
                                <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden rounded-b-2xl">
                                     <div className="absolute left-0 w-full h-[2px] bg-indigo-400 shadow-[0_0_15px_rgba(129,140,248,0.8)] animate-[scan-line_3s_linear_infinite]"></div>
                                     <div className="absolute left-0 w-full h-32 bg-gradient-to-b from-indigo-500/20 to-transparent animate-[scan-line_3s_linear_infinite]"></div>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-24 px-6 bg-[#0B0C15] relative">
                <div className="max-w-7xl mx-auto">
                    <div className="text-center max-w-3xl mx-auto mb-16">
                        <h2 className="text-4xl font-bold text-white mb-4">Everything You Need to Ace It</h2>
                        <p className="text-lg text-slate-400">We don't just read the paper; we understand it. Our AI provides deep insights to help you study smarter, not harder.</p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {[
                            { icon: BrainIcon, title: "Deep Analysis", desc: "Our AI reads every question, extracting text, diagrams, and context with near-perfect accuracy.", color: "indigo" },
                            { icon: LayersIcon, title: "Topic Classifier", desc: "Automatically categorizes questions by chapter and topic so you know what to focus on.", color: "purple" },
                            { icon: ChartBarIcon, title: "Weightage Graphs", desc: "Visual breakdown of marks distribution. Spot the high-value topics instantly.", color: "pink" },
                            { icon: CheckCircleIcon, title: "Smart Answers", desc: "Get detailed, step-by-step solutions generated by AI for every single question.", color: "green" },
                            { icon: UsersIcon, title: "Similar Questions", desc: "Never run out of practice material. AI generates new questions based on the same pattern.", color: "orange" },
                            { icon: ZapIcon, title: "Difficulty Scoring", desc: "Know the difficulty level (Easy, Medium, Hard) of every question at a glance.", color: "yellow" },
                        ].map((feature, idx) => (
                            <div key={idx} className={`group p-8 rounded-3xl bg-[#131520] border border-slate-800 hover:border-indigo-500/30 hover:bg-[#1A1D29] transition-all duration-300`}>
                                <div className={`w-14 h-14 rounded-2xl bg-${feature.color}-900/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300`}>
                                    <feature.icon className={`w-8 h-8 text-${feature.color}-400`} />
                                </div>
                                <h3 className="text-xl font-bold text-white mb-3">{feature.title}</h3>
                                <p className="text-slate-400 leading-relaxed">{feature.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How it Works */}
            <section id="how-it-works" className="py-24 px-6 bg-[#0F111A]">
                <div className="max-w-7xl mx-auto">
                    <h2 className="text-4xl font-bold text-white text-center mb-16">From Paper to Insights in 3 Steps</h2>
                    
                    <div className="grid md:grid-cols-3 gap-8 relative">
                        {/* Connector Line */}
                        <div className="hidden md:block absolute top-1/2 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-slate-800 to-transparent -translate-y-1/2 z-0"></div>

                        {[
                            { step: "01", title: "Upload Paper", desc: "Drag & drop images of your question paper." },
                            { step: "02", title: "AI Processing", desc: "We analyze text, topics, and marks instantly." },
                            { step: "03", title: "Get Results", desc: "Review answers, summary & start practicing." }
                        ].map((item, idx) => (
                            <div key={idx} className="relative z-10 flex flex-col items-center text-center">
                                <div className="w-16 h-16 rounded-2xl bg-[#131520] border-2 border-indigo-500/50 text-indigo-400 text-2xl font-bold flex items-center justify-center shadow-lg mb-6 shadow-indigo-500/10">
                                    {item.step}
                                </div>
                                <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
                                <p className="text-slate-400 max-w-xs">{item.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Showcase / CTA */}
            <section className="py-20 px-6">
                <div className="max-w-6xl mx-auto bg-gradient-to-br from-indigo-600 to-purple-700 rounded-[3rem] p-12 sm:p-20 text-center text-white relative overflow-hidden shadow-2xl">
                    <div className="absolute top-0 left-0 w-full h-full bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
                    
                    <div className="relative z-10 max-w-3xl mx-auto space-y-8">
                        <h2 className="text-4xl sm:text-5xl font-bold">Ready to Boost Your Grades?</h2>
                        <p className="text-lg sm:text-xl text-indigo-100">Join thousands of students using AI to decode their exams. Analysis takes less than 30 seconds.</p>
                        <button 
                            onClick={onLogin}
                            className="inline-flex items-center gap-2 bg-white text-indigo-600 px-8 py-4 rounded-full font-bold text-lg shadow-lg hover:bg-slate-100 transition-colors hover:scale-105 transform duration-200"
                        >
                            Try QuickStudy Free
                        </button>
                    </div>
                </div>
            </section>

            {/* Testimonials */}
            <section className="py-24 px-6 bg-[#0B0C15]">
                <div className="max-w-7xl mx-auto">
                    <h2 className="text-3xl font-bold text-center mb-12 text-white">Loved by Students</h2>
                    <div className="grid md:grid-cols-3 gap-8">
                        {[
                            { name: "Alex M.", role: "Engineering Student", text: "This tool saved me during finals. The topic weightage graph changed how I prioritized my study time." },
                            { name: "Sarah L.", role: "High School Senior", text: "I used to spend hours searching for answers to PYQs. Now I get them instantly with explanations." },
                            { name: "Davide K.", role: "Medical Student", text: "The similar questions feature is a game changer. It helps me practice exactly what I need." },
                        ].map((t, idx) => (
                            <div key={idx} className="p-8 bg-[#131520] rounded-3xl border border-slate-800">
                                <div className="flex gap-1 text-yellow-400 mb-4">
                                    {[...Array(5)].map((_, i) => <StarIcon key={i} className="w-5 h-5" />)}
                                </div>
                                <p className="text-slate-300 mb-6 font-medium">"{t.text}"</p>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center font-bold text-indigo-400">
                                        {t.name[0]}
                                    </div>
                                    <div>
                                        <p className="font-bold text-white text-sm">{t.name}</p>
                                        <p className="text-xs text-slate-500">{t.role}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>


            {/* Footer */}
            <footer className="bg-[#0B0C15] border-t border-slate-800 py-12 px-6">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                       
                       
                    </div>
                   
                    <div className="text-sm text-slate-500">
                        © {new Date().getFullYear()} QuickStudy AI By Bhushan Chavan.
                    </div>
                </div>
            </footer>
        </div>
    );
};

const App: React.FC = () => {
    const [theme, setTheme] = useState<Theme>('light');
    const [user, setUser] = useState<User | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

    // Analysis State
    const [files, setFiles] = useState<File[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [currentAnalysis, setCurrentAnalysis] = useState<AnalysisResult | null>(null);
    const [analysisId, setAnalysisId] = useState<string | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);

    // Chat State
    const [chatSession, setChatSession] = useState<Chat | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputMessage, setInputMessage] = useState("");
    const [isChatStreaming, setIsChatStreaming] = useState(false);
    
    // Auto-scroll chat
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(scrollToBottom, [messages]);

    useEffect(() => {
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }, [theme]);

    const handleLogin = async () => {
        try {
            const firebaseUser = await loginWithGoogle();
            setUser({
                name: firebaseUser.displayName || 'User',
                email: firebaseUser.email || '',
                avatar: firebaseUser.photoURL || ''
            });
        } catch (error) {
            console.warn("Using demo user due to error:", error);
            setUser({
                name: 'Demo User',
                email: 'demo@quickstudy.ai',
                avatar: ''
            });
        }
    };

    const handleLogout = async () => {
        await logoutUser();
        setUser(null);
        setCurrentAnalysis(null);
        setFiles([]);
        setMessages([]);
    };

    const startAnalysis = async () => {
        if (files.length === 0) return;
        setIsAnalyzing(true);
        setCurrentAnalysis({ summary: "Analyzing your document... This usually takes 10-20 seconds.", keyConcepts: [], questions: [] });
        
        try {
            const stream = await analyzeQuestionPapersStream(files);
            let accumulatedText = "";

            for await (const chunk of stream) {
                // Correct Gemini SDK 2.0 Usage: chunk.text is a getter property
                const text = chunk.text;
                if (text) {
                    accumulatedText += text;
                    // Update UI with partial result (optimistic parsing)
                    const parsed = parseStreamingJson(accumulatedText);
                    // Only update if we have some meaningful data
                    if (parsed.summary || parsed.keyConcepts.length > 0 || parsed.questions.length > 0) {
                        setCurrentAnalysis(prev => ({ ...parsed }));
                    }
                }
            }

            // Final Parse
            const finalResult = parseStreamingJson(accumulatedText);
            setCurrentAnalysis(finalResult);
            
            const newId = Date.now().toString();
            setAnalysisId(newId);
            setHistory(prev => [{
                id: newId,
                title: finalResult.questions.length > 0 ? `${finalResult.questions[0].mainTopic} Analysis` : "New Analysis",
                date: Date.now(),
                analysisResult: finalResult
            }, ...prev]);

            // Start Chat
            const chat = startChatSession(finalResult);
            setChatSession(chat);
            setMessages([{ role: 'model', text: "I've analyzed the paper! You can ask me about specific questions, concepts, or for more practice problems." }]);

        } catch (error) {
            console.error(error);
            alert("Failed to analyze. Please try again.");
            setCurrentAnalysis(null);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const handleSendMessage = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputMessage.trim() || !chatSession) return;
        
        const text = inputMessage;
        setInputMessage("");
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsChatStreaming(true);

        try {
            const resultStream = await chatSession.sendMessageStream({ message: text });
            
            setMessages(prev => [...prev, { role: 'model', text: "" }]);
            
            let fullResponse = "";
            for await (const chunk of resultStream) {
                const chunkText = (chunk as GenerateContentResponse).text;
                if (chunkText) {
                    fullResponse += chunkText;
                    setMessages(prev => {
                        const newArr = [...prev];
                        newArr[newArr.length - 1].text = fullResponse;
                        return newArr;
                    });
                }
            }
        } catch (err) {
            console.error(err);
             setMessages(prev => [...prev, { role: 'model', text: "Sorry, I had trouble replying. Please try again." }]);
        } finally {
            setIsChatStreaming(false);
        }
    };

    // Render logic
    if (!user) return <LandingPage onLogin={handleLogin} />;

    return (
        <div className={`flex h-screen bg-slate-50 dark:bg-black transition-colors duration-200 ${theme}`}>
            <Sidebar 
                isOpen={isSidebarOpen}
                isDesktopCollapsed={isDesktopCollapsed}
                toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                toggleDesktopCollapse={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
                history={history}
                currentId={analysisId}
                user={user}
                onSelect={(item) => {
                    setCurrentAnalysis(item.analysisResult);
                    setAnalysisId(item.id);
                    const chat = startChatSession(item.analysisResult);
                    setChatSession(chat);
                    setMessages([{ role: 'model', text: "Chat session restored." }]);
                }}
                onNewChat={() => {
                    setCurrentAnalysis(null);
                    setAnalysisId(null);
                    setFiles([]);
                    setMessages([]);
                }}
                onDelete={(id, e) => {
                    e.stopPropagation();
                    setHistory(h => h.filter(x => x.id !== id));
                    if (analysisId === id) {
                        setCurrentAnalysis(null);
                        setAnalysisId(null);
                    }
                }}
                onLogout={handleLogout}
            />

            <div className="flex-1 flex flex-col h-full overflow-hidden relative w-full">
                <Header 
                    theme={theme}
                    onThemeChange={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                    toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
                    isDesktopCollapsed={isDesktopCollapsed}
                    toggleDesktopCollapse={() => setIsDesktopCollapsed(!isDesktopCollapsed)}
                />

                <main className="flex-1 overflow-hidden relative">
                    {!currentAnalysis ? (
                        <div className="h-full overflow-y-auto p-4 sm:p-8">
                            <div className="max-w-2xl mx-auto mt-12 text-center space-y-8">
                                <div className="space-y-4">
                                    <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
                                        <UploadIcon className="w-8 h-8" />
                                    </div>
                                    <h2 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Upload Question Paper</h2>
                                    <p className="text-slate-500 dark:text-slate-400 text-lg">
                                        Upload clear images of your exam paper (JPG, PNG). We'll analyze questions, marks, and provide answers.
                                    </p>
                                </div>

                                <div 
                                    className={`
                                        border-3 border-dashed rounded-3xl p-10 transition-all duration-200
                                        ${files.length > 0 ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/10' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'}
                                    `}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (e.dataTransfer.files) setFiles(Array.from(e.dataTransfer.files));
                                    }}
                                >
                                    <input 
                                        type="file" 
                                        id="file-upload" 
                                        multiple 
                                        accept="image/*"
                                        className="hidden" 
                                        onChange={(e) => e.target.files && setFiles(Array.from(e.target.files))}
                                    />
                                    
                                    {files.length === 0 ? (
                                        <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                                            <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-800 px-4 py-2 rounded-full shadow-sm">Browse Files</span>
                                            <span className="text-slate-400 text-sm">or drag and drop here</span>
                                        </label>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex flex-wrap gap-2 justify-center">
                                                {files.map((f, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1 bg-white dark:bg-slate-800 px-3 py-1 rounded-full text-sm text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                        {f.name}
                                                    </span>
                                                ))}
                                            </div>
                                            <button onClick={() => setFiles([])} className="text-xs text-red-500 hover:underline">Clear all</button>
                                        </div>
                                    )}
                                </div>

                                <button 
                                    onClick={startAnalysis}
                                    disabled={files.length === 0 || isAnalyzing}
                                    className={`
                                        w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all
                                        ${files.length > 0 && !isAnalyzing
                                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white hover:-translate-y-0.5' 
                                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'}
                                    `}
                                >
                                    {isAnalyzing ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Analyzing...
                                        </span>
                                    ) : 'Analyze Paper'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex h-full flex-col lg:flex-row overflow-hidden">
                            {/* Left Panel: Content */}
                            <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                                
                                {/* Summary Card */}
                                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800">
                                    <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                                        <ChartBarIcon className="w-5 h-5 text-indigo-500" />
                                        Overview
                                    </h2>
                                    <div className="prose prose-slate dark:prose-invert max-w-none text-slate-600 dark:text-slate-300">
                                        {currentAnalysis.summary}
                                    </div>
                                </div>

                                {/* NEW: Strategic Study Guide */}
                                {currentAnalysis.keyConcepts && currentAnalysis.keyConcepts.length > 0 && (
                                    <div className="space-y-4">
                                        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                            <ZapIcon className="w-5 h-5 text-yellow-500" />
                                            Strategic Study Guide
                                        </h3>
                                        <div className="grid sm:grid-cols-2 gap-4">
                                            {currentAnalysis.keyConcepts.map((concept, idx) => (
                                                <div key={idx} className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 flex flex-col relative overflow-hidden group hover:border-indigo-500/30 transition-all">
                                                    <div className={`absolute top-0 right-0 px-3 py-1 rounded-bl-lg text-xs font-bold
                                                        ${concept.importance === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                                                          concept.importance === 'Medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                                                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'}
                                                    `}>
                                                        {concept.importance} Priority
                                                    </div>
                                                    <h4 className="font-bold text-slate-800 dark:text-slate-100 mb-2 pr-20">{concept.name}</h4>
                                                    <p className="text-sm text-slate-600 dark:text-slate-400">{concept.description}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Questions List */}
                                <div className="space-y-4">
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                        <LayersIcon className="w-5 h-5 text-purple-500" />
                                        Questions & Answers
                                    </h3>
                                    
                                    {currentAnalysis.questions.length === 0 && (
                                        <div className="text-center py-10 text-slate-400">Loading questions...</div>
                                    )}

                                    {currentAnalysis.questions.map((q, idx) => (
                                        <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-800 group transition-all hover:border-indigo-500/30">
                                            <div className="flex justify-between items-start gap-4 mb-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-1 rounded-lg text-sm font-bold">
                                                        Q{q.questionNumber}
                                                    </span>
                                                    <span className="text-xs font-medium px-2 py-1 rounded-md bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
                                                        {q.mainTopic}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs font-bold px-2 py-1 rounded-md border 
                                                        ${q.difficulty === 'Easy' ? 'border-green-200 text-green-600 bg-green-50 dark:bg-green-900/10 dark:border-green-800 dark:text-green-400' : 
                                                          q.difficulty === 'Medium' ? 'border-yellow-200 text-yellow-600 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800 dark:text-yellow-400' : 
                                                          'border-red-200 text-red-600 bg-red-50 dark:bg-red-900/10 dark:border-red-800 dark:text-red-400'}`}>
                                                        {q.difficulty}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md">
                                                        {q.marks} Marks
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            <p className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-6 font-serif leading-relaxed">
                                                {q.questionText}
                                            </p>

                                            <div className="space-y-4">
                                                <div className="bg-indigo-50/50 dark:bg-[#0F111A] rounded-xl p-5 border border-indigo-100 dark:border-slate-800">
                                                    <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-300 mb-2 uppercase tracking-wide">Answer</h4>
                                                    <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300" 
                                                         dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(q.correctAnswer || '') as string) }}>
                                                    </div>
                                                </div>

                                                {q.similarQuestions && q.similarQuestions.length > 0 && (
                                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-5 border border-slate-100 dark:border-slate-800">
                                                        <h4 className="text-sm font-bold text-slate-700 dark:text-slate-400 mb-2 flex items-center gap-2">
                                                            <SparklesIcon className="w-4 h-4 text-amber-500" />
                                                            Practice Similar Questions
                                                        </h4>
                                                        <ul className="list-disc list-outside ml-4 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                                                            {q.similarQuestions.map((sq, i) => (
                                                                <li key={i}>{sq}</li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Right Panel: Chat (Sticky on Desktop, Stacked on Mobile) */}
                            <div className="w-full lg:w-[400px] border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-black flex flex-col h-[500px] lg:h-full">
                                <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50">
                                    <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                        <ChatBubbleIcon className="w-5 h-5 text-indigo-500" />
                                        AI Tutor
                                    </h3>
                                    <span className="text-xs text-slate-500">Based on this paper</span>
                                </div>
                                
                                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30 dark:bg-black">
                                    {messages.map((msg, i) => (
                                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`
                                                max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
                                                ${msg.role === 'user' 
                                                    ? 'bg-indigo-600 text-white rounded-br-none' 
                                                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-bl-none'}
                                            `}>
                                                {msg.role === 'model' 
                                                    ? <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(msg.text) as string) }} />
                                                    : msg.text
                                                }
                                            </div>
                                        </div>
                                    ))}
                                    <div ref={messagesEndRef} />
                                </div>

                                <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-black">
                                    <form onSubmit={handleSendMessage} className="relative">
                                        <input
                                            type="text"
                                            value={inputMessage}
                                            onChange={(e) => setInputMessage(e.target.value)}
                                            placeholder="Ask a doubt..."
                                            disabled={isChatStreaming}
                                            className="w-full pl-4 pr-12 py-3 rounded-xl bg-slate-100 dark:bg-slate-900 border-none focus:ring-2 focus:ring-indigo-500 text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500"
                                        />
                                        <button 
                                            type="submit" 
                                            disabled={!inputMessage.trim() || isChatStreaming}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-lg disabled:opacity-50"
                                        >
                                            <SendIcon className="w-5 h-5" />
                                        </button>
                                    </form>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default App;
