import { MemoryCache } from "starpod";
import { EVENTS } from "../../infra/platform";
import type { EventBus } from "starpod";
import type { DomainEvents } from "../../infra/platform";

export type Pet = {
  readonly id: string;
  readonly name: string;
  readonly species: string;
};

export class PetsService {
  static readonly inject = [MemoryCache, EVENTS] as const;
  private readonly pets: Pet[] = [];

  constructor(
    private readonly cache: MemoryCache,
    private readonly events: EventBus<DomainEvents>,
  ) {}

  list() {
    return this.pets;
  }

  find(id: string) {
    return this.cache.get<Pet>(`pet:${id}`) ?? this.pets.find((pet) => pet.id === id);
  }

  async create(name: string, species: string) {
    const pet = Object.freeze({ id: crypto.randomUUID(), name, species });
    this.pets.push(pet);
    this.cache.set(`pet:${pet.id}`, pet, { tags: ["pets"] });
    await this.events.emit("pet.created", { id: pet.id, name: pet.name });
    return pet;
  }
}
