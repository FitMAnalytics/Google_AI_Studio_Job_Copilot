export interface BulletPoint {
  raw_text: string;
}

export interface WorkExperience {
  company_name: string;
  role_title: string;
  dates_employed: string;
  location: string;
  bullet_points: BulletPoint[];
}

export interface Project {
  project_name: string;
  role_title: string;
  technologies_used: string[];
  bullet_points: BulletPoint[];
}

export interface Education {
  institution_name: string;
  degree_obtained: string;
  graduation_date: string;
  achievements: string[];
}

export interface SkillGroup {
  category_name: string;
  items: string[];
}

export interface ContactInfo {
  full_name: string;
  email: string;
  phone: string;
  linkedin_url: string;
  github_url: string;
  website_url: string;
  location: string;
}

export interface ParsedResume {
  contact_info: ContactInfo;
  professional_summary: string;
  work_experience: WorkExperience[];
  projects: Project[];
  education: Education[];
  skills: SkillGroup[];
  certifications: string[];
}

export interface CorpusChunk {
  text: string;
  metadata: Record<string, any>;
}

export interface EnrichedCorpusItem {
  id: string;
  content: string; // The fused natural language sentence
  keywords: string[];
  skills_implied: string[];
  category: string;
  raw_source: string;
  metadata: Record<string, any>;
  embedding?: number[]; // The vector representation
}

export enum AppMode {
  UPLOAD = 'UPLOAD',
  DASHBOARD = 'DASHBOARD',
}

export enum CopilotAction {
  TAILOR_RESUME = 'TAILOR_RESUME',
  COVER_LETTER = 'COVER_LETTER',
  INTERVIEW_PREP = 'INTERVIEW_PREP',
}

export interface GeneratedContent {
  type: CopilotAction;
  content: string;
  timestamp: number;
}

export interface FileData {
  base64: string;
  mimeType: string;
  name: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}
