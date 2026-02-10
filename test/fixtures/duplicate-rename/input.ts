// Entry file - imports Status from two modules that re-export from different sources
// This should trigger the $1 suffix renaming issue
export { ServiceA } from "./serviceA";
export { ServiceB } from "./serviceB";
