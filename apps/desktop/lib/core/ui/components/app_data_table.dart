import 'package:flutter/material.dart';
import 'package:my_shop_desktop/core/ui/theme/app_typography.dart';

/// The client's tabular list (section 6.9).
///
/// Header and cell strings are catalogued or caller-owned; the table itself
/// decides nothing about what a row means. It scrolls horizontally inside its
/// own viewport so a wide inventory never widens the screen.
class AppDataTable extends StatelessWidget {
  const AppDataTable({
    required this.columns,
    required this.rows,
    super.key,
  });

  /// One catalogued header per column, in display order.
  final List<String> columns;

  /// One list of cell strings per row; short rows are padded by `DataTable`.
  final List<List<String>> rows;

  @override
  Widget build(BuildContext context) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        headingTextStyle: textTheme.labelLarge ?? AppTypography.label,
        dataTextStyle: textTheme.bodyMedium ?? AppTypography.body,
        columns: <DataColumn>[
          for (final String column in columns) DataColumn(label: Text(column)),
        ],
        rows: <DataRow>[
          for (final List<String> row in rows)
            DataRow(
              cells: <DataCell>[
                for (final String cell in row) DataCell(Text(cell)),
              ],
            ),
        ],
      ),
    );
  }
}
