import { atlas, star } from "starpod";

export const HelloAtlas = atlas("hello", {
  prefix: "/hello",
  stars: {
    greet: star.get("/"),
  },
});
