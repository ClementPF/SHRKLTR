package calc.service;

import calc.DTO.SportDTO;
import calc.DTO.TournamentDTO;
import calc.entity.Sport;
import calc.repository.SportRepository;
import calc.repository.TournamentRepository;
import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Created by clementperez on 9/25/16.
 */
@Service
public class SportService {

    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private ModelMapper modelMapper;

    public List<TournamentDTO> findBySport(Sport sport){
        return tournamentRepository.findBySport(sport).stream()
                .map(s -> tournamentService.convertToDto(s)).collect(Collectors.toList());
    }

    public SportDTO save(SportDTO sport){
        try {
            return convertToDto(sportRepository.save(convertToEntity(sport)));
        } catch (ParseException e) {
            e.printStackTrace();
        }

        return null;
    }

    public SportDTO findByName(String name){
        return convertToDto(sportRepository.findByName(name));
    }

    protected Sport convertToEntity(SportDTO sportDto) throws ParseException {

        //Sport sport = modelMapper.map(sportDto, Sport.class);

        Sport sport = new Sport(sportDto.getName());

        if (sportDto.getSportId() != null) {
            sport.setSportId(sportDto.getSportId());
            sport.setTournaments(tournamentRepository.findBySportId(sportDto.getSportId()));
        }
        return sport;
    }

    protected SportDTO convertToDto(Sport sport) {
        //SportDTO sportDTO = modelMapper.map(sport, SportDTO.class);

        SportDTO sportDTO = new SportDTO();
        sportDTO.setSportId(sport.getSportId());
        sportDTO.setName(sport.getName());
        return sportDTO;
    }

    public List<SportDTO> findAll() {
        List<Sport> copy = new ArrayList<>();

        for (Sport sport : sportRepository.findAll()) {
            copy.add(sport);
        }
        return copy.stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }
}
