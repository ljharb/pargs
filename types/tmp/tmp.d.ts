declare module 'tmp' {
    const tmp: {
        dirSync(options?: object | Function): { name: string, removeCallback(): void };
    };
    export default tmp;
}