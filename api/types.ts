export type ApiRequest = {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    body?: any;
};

export type ApiResponse = {
    status: (code: number) => ApiResponse;
    json: (body: unknown) => void;
    send?: (body: unknown) => void;
};
