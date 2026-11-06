To create DB

install mysql

- Create sharkulator DB

1. mysql.server start
2. create database sharkulator;

- Then to import tables from file
mysql -u root -p sharkulator < /Users/clementperez/Code/BackEnd/sharkulator/target/classes/sharkulator_schema_2.sql

To debug
create remote configuration : -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005
run : mvn clean spring-boot:run -Drun.jvmArguments="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005"
then run remote configuration
