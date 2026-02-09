export interface Person {
  id: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  linkedinUrl?: string;
  title?: string;
  location?: string;
  bio?: string;
  avatarUrl?: string;
  source: string[];
  ownerId: string;
  enrichedAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Company {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  location?: string;
  linkedinUrl?: string;
  createdAt: Date;
}

export interface KueUser {
  id: string;
  email: string;
  name?: string;
  createdAt: Date;
}

export interface Relationship {
  strength: number;
  lastContact?: Date;
  emailCount: number;
  meetingCount: number;
  firstInteraction?: Date;
  interactionRecency: number;
}

export interface SearchIntent {
  queryType: 'person_search' | 'company_search' | 'relationship_query' | 'intro_path' | 'general';
  filters: {
    roles?: string[];
    companies?: string[];
    locations?: string[];
    industries?: string[];
    skills?: string[];
    name?: string;
    title?: string;
    degree?: 1 | 2 | 3;
    sort?: 'strength' | 'recency' | 'relevance';
    [key: string]: unknown;
  };
  naturalLanguage: string;
}

export interface SearchResult {
  person: Person;
  strength: number;
  degree: number;
  via?: Person;
  company?: Company;
}

export interface Contact {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
  source: string;
}

export interface Interaction {
  type: 'email' | 'meeting' | 'contact';
  date: Date;
  direction?: 'sent' | 'received';
}

export interface ScoreBreakdown {
  recency: number;
  frequency: number;
  reciprocity: number;
  diversity: number;
  duration: number;
}
