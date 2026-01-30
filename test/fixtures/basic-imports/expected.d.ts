interface Helper {
  assist: () => void;
}
export interface User {
  id: number;
  name: string;
  helper: Helper;
}
