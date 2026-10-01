declare module '*.css';
declare module '*?url' { const url: string; export default url; }
declare module '*?raw' { const content: string; export default content; }
interface ImportMetaEnv { readonly VITE_SUPPORT_URL?: string; readonly VITE_DONATION_LINKS?: string; }
interface ImportMeta { readonly env: ImportMetaEnv; }
