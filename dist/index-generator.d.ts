interface Transcript {
    filename: string;
    displayName: string;
    lastActivity: Date | null;
}
export declare function generateGuildIndex(guildName: string, threads: Transcript[]): string;
export {};
