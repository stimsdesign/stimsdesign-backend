/**
 * Converts a year (or any number) to a Roman numeral string.
 * @param year The year to convert. Defaults to the current year.
 * @returns The Roman numeral representation of the year.
 */
export function getRomanYear(year: number = new Date().getFullYear()): string {
    const romanMap: [number, string][] = [
        [1000, "M"],
        [900, "CM"],
        [500, "D"],
        [400, "CD"],
        [100, "C"],
        [90, "XC"],
        [50, "L"],
        [40, "XL"],
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"]
    ];

    let numeral = "";
    let remaining = year;

    for (const [value, symbol] of romanMap) {
        while (remaining >= value) {
            numeral += symbol;
            remaining -= value;
        }
    }

    return numeral;
}
