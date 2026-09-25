import { EventBus, provideFactory, token } from "starpod";

export type DomainEvents = {
  "pet.created": { readonly id: string; readonly name: string };
};

export const EVENTS = token<EventBus<DomainEvents>>("petcare.events");
export const events = provideFactory(EVENTS, [], () => new EventBus<DomainEvents>());
