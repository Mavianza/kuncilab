const lock = name => ({op: "lock", lock: name});
const unlock = name => ({op: "unlock", lock: name});
const work = label => ({op: "work", label});

export const examples = {
  silang: {
    name: "Dua mutex, urutan terbalik",
    locks: ["A", "B"],
    threads: [
      {id: "T1", steps: [lock("A"), lock("B"), work("Perbarui data"), unlock("B"), unlock("A")]},
      {id: "T2", steps: [lock("B"), lock("A"), work("Baca data"), unlock("A"), unlock("B")]},
    ],
  },
  searah: {
    name: "Dua mutex, urutan konsisten",
    locks: ["A", "B"],
    threads: [
      {id: "T1", steps: [lock("A"), lock("B"), work("Perbarui data"), unlock("B"), unlock("A")]},
      {id: "T2", steps: [lock("A"), lock("B"), work("Baca data"), unlock("B"), unlock("A")]},
    ],
  },
  cincin: {
    name: "Siklus tiga thread",
    locks: ["A", "B", "C"],
    threads: [
      {id: "T1", steps: [lock("A"), lock("B"), unlock("B"), unlock("A")]},
      {id: "T2", steps: [lock("B"), lock("C"), unlock("C"), unlock("B")]},
      {id: "T3", steps: [lock("C"), lock("A"), unlock("A"), unlock("C")]},
    ],
  },
};
